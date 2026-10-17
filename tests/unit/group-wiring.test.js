import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const SYNTHETIC_CONFIG = {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect',
  JWT_SECRET: 'synthetic-group-wiring-secret-that-is-not-used-outside-tests',
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

const groupRow = { id: 'group-1', academic_year: 2026, curriculum_semester: 7, name: 'Physics', created_by: 'actor-1', created_at: new Date('2026-03-04T05:06:07Z') };

async function withApp(run, { grants = {}, failPermissionRead = false } = {}) {
  let fail = failPermissionRead;
  const queries = [];
  const pool = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes('FROM role_permissions')) {
        if (fail) throw new Error('permission reader unavailable');
        return { rows: (grants[params[0]] ?? []).map((permission) => ({ permission })) };
      }
      if (text.includes('INSERT INTO academic_groups')) return { rows: [{ ...groupRow, academic_year: params[0], curriculum_semester: params[1], name: params[2], created_by: params[3] }] };
      if (text.includes('FROM academic_groups')) return { rows: [groupRow] };
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const app = createApp(pool);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const service = new JwtTokenService({ secret: SYNTHETIC_CONFIG.JWT_SECRET, secretKid: 'test-key', previousSecrets: [], expiresIn: '1h' });
  try {
    await run(`http://127.0.0.1:${server.address().port}`, service, queries, (value) => { fail = value; });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function token(service, role, sub, permissions = []) {
  return service.sign({ role, sub, permissions });
}

function auth(tokenValue) { return { authorization: `Bearer ${tokenValue}` }; }

test('production wiring authorizes independent fresh grants and ignores stale token permission claims', async () => {
  const grants = { reader: ['groups:read'], writer: ['groups:write'], delegated: ['groups:read', 'groups:write'] };
  await withApp(async (base, service, queries) => {
    const reader = await token(service, 'reader', 'reader-1', ['groups:write', 'groups:read']);
    assert.equal((await fetch(`${base}/groups`, { headers: auth(reader) })).status, 200);
    assert.equal((await fetch(`${base}/groups`, { method: 'POST', headers: { ...auth(reader), 'content-type': 'application/json' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 1, name: 'Denied' }) })).status, 403);
    const writer = await token(service, 'writer', 'writer-1', ['groups:read']);
    const created = await fetch(`${base}/groups`, { method: 'POST', headers: { ...auth(writer), 'content-type': 'application/json' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 7, name: 'Physics', created_by: 'spoof' }) });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).created_by, 'writer-1');
    assert.equal((await fetch(`${base}/groups`, { headers: auth(writer) })).status, 403);
    const delegate = await token(service, 'custom_non_admin', 'delegate-1', []);
    assert.equal((await fetch(`${base}/groups`, { method: 'POST', headers: { ...auth(delegate), 'content-type': 'application/json' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 2, name: 'Delegated' }) })).status, 403);
    grants.custom_non_admin = ['groups:write'];
    assert.equal((await fetch(`${base}/groups`, { method: 'POST', headers: { ...auth(delegate), 'content-type': 'application/json' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 2, name: 'Delegated' }) })).status, 201);
    assert.equal(queries.filter(({ text }) => text.includes('FROM role_permissions')).length, 6);
  }, { grants });
});

test('a verified token without sub keeps nullable attribution and grants are checked afresh', async () => {
  const grants = { admin: ['groups:write'] };
  await withApp(async (base, service) => {
    const adminWithoutSubject = await token(service, 'admin', undefined, ['groups:write']);
    const response = await fetch(`${base}/groups`, { method: 'POST', headers: { ...auth(adminWithoutSubject), 'content-type': 'application/json' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 1, name: 'Anonymous actor', created_by: 'spoofed' }) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).created_by, null);
  }, { grants });
});

test('admin claims cannot bypass missing grants and a same-token permission revocation is immediate', async () => {
  const grants = {};
  await withApp(async (base, service) => {
    const admin = await token(service, 'admin', 'admin-1', ['groups:read', 'groups:write']);
    assert.equal((await fetch(`${base}/groups`, { headers: auth(admin) })).status, 403);
    const delegate = await token(service, 'delegate', 'delegate-1', []);
    grants.delegate = ['groups:write'];
    const options = { method: 'POST', headers: { ...auth(delegate), 'content-type': 'application/json' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 1, name: 'Allowed' }) };
    assert.equal((await fetch(`${base}/groups`, options)).status, 201);
    grants.delegate = [];
    assert.equal((await fetch(`${base}/groups`, options)).status, 403);
  }, { grants });
});

test('permission matrix failures propagate as server errors', async () => {
  await withApp(async (base, service, queries) => {
    const reader = await token(service, 'reader', 'reader-1');
    assert.equal((await fetch(`${base}/groups`, { headers: auth(reader) })).status, 500);
    assert.equal(queries.length, 1);
  }, { failPermissionRead: true });
});
