import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const SYNTHETIC_CONFIG = {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect',
  JWT_SECRET: 'synthetic-subject-wiring-secret-that-is-not-used-outside-tests',
  CLIENT_URL: 'http://127.0.0.1:1',
  JWT_SECRET_KID: 'test-key',
  JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h',
  BCRYPT_COST: '4',
  RESET_TOKEN_TTL: '15',
  RESET_TOKEN_MAX_OUTSTANDING: '3',
};
Object.assign(process.env, SYNTHETIC_CONFIG);

const [{ createApp }, { JwtTokenService }] = await Promise.all([
  import('../../src/app.ts'),
  import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
]);

const grants = {
  admin: ['subjects:read', 'subjects:write'],
  teacher: ['subjects:read', 'subjects:write'],
  estudiante: ['materias:read'],
};
const subjectRow = { id: 'subject-1', name: 'Physics', created_by: 'actor-1', created_at: new Date('2026-03-04T05:06:07Z') };

async function withApp(run, { failPermissionRead = false, grantsOverride = grants } = {}) {
  let fail = failPermissionRead;
  const queries = [];
  const pool = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes('FROM role_permissions')) {
        if (fail) throw new Error('permission reader unavailable');
        return { rows: (grantsOverride[params[0]] ?? []).map((permission) => ({ permission })) };
      }
      if (text.includes('INSERT INTO subjects')) return { rows: [{ ...subjectRow, name: params[0], created_by: params[1] }] };
      if (text.includes('FROM subjects')) return { rows: [subjectRow] };
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const app = createApp(pool);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tokenService = new JwtTokenService({ secret: SYNTHETIC_CONFIG.JWT_SECRET, secretKid: 'test-key', previousSecrets: [], expiresIn: '1h' });
  try {
    await run(`http://127.0.0.1:${server.address().port}`, tokenService, queries, (value) => { fail = value; });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function token(service, role, sub, permissions = []) {
  return service.sign({ role, sub, permissions });
}

test('production wiring uses fresh database grants, independent of role and token permission claims', async () => {
  await withApp(async (base, service, queries) => {
    const studentToken = await token(service, 'estudiante', 'student-1', ['subjects:write', 'subjects:read']);
    const denied = await fetch(`${base}/subjects`, { headers: { authorization: `Bearer ${studentToken}` } });
    assert.equal(denied.status, 403);

    const teacherToken = await token(service, 'teacher', 'teacher-1', []);
    const read = await fetch(`${base}/subjects`, { headers: { authorization: `Bearer ${teacherToken}` } });
    assert.equal(read.status, 200, 'explicit database read grant authorizes a non-admin');
    const create = await fetch(`${base}/subjects`, { method: 'POST', headers: { authorization: `Bearer ${teacherToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: ' Physics ', createdBy: 'forged' }) });
    assert.equal(create.status, 201, 'explicit database write grant is independently effective');
    assert.equal((await create.json()).created_by, 'teacher-1');

    const legacyOnly = await token(service, 'estudiante', 'student-2', ['materias:read']);
    const legacyDenied = await fetch(`${base}/subjects`, { headers: { authorization: `Bearer ${legacyOnly}` } });
    assert.equal(legacyDenied.status, 403);
    assert.equal(queries.filter((query) => query.text.includes('FROM role_permissions')).length, 4);
  });
});

test('admin role and token claims do not replace an empty fresh database grant set', async () => {
  await withApp(async (base, service) => {
    const adminToken = await token(service, 'admin', 'admin-1', ['subjects:read', 'subjects:write']);
    assert.equal((await fetch(`${base}/subjects`, { headers: { authorization: `Bearer ${adminToken}` } })).status, 403);
  }, { grantsOverride: { admin: [] } });
});

test('missing and invalid bearer tokens never reach the permission query', async () => {
  await withApp(async (base, _service, queries) => {
    assert.equal((await fetch(`${base}/subjects`)).status, 401);
    assert.equal((await fetch(`${base}/subjects`, { headers: { authorization: 'Bearer invalid.token' } })).status, 401);
    assert.equal(queries.filter((query) => query.text.includes('FROM role_permissions')).length, 0);
  });
});

test('fresh permission reader failures propagate through production error handling', async () => {
  await withApp(async (base, service, queries) => {
    const admin = await token(service, 'admin', 'admin-1', []);
    const response = await fetch(`${base}/subjects`, { headers: { authorization: `Bearer ${admin}` } });
    assert.equal(response.status, 500);
    assert.equal(queries.length, 1);
  }, { failPermissionRead: true });
});
