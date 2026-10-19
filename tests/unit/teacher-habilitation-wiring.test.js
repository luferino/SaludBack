import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Define every required setting before importing app/config; no dotenv fallback or real pool is used.
const SYNTHETIC_CONFIG = {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect',
  JWT_SECRET: 'synthetic-teacher-habilitation-wiring-secret',
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

const INPUT = {
  teacher_id: '30000000-0000-4000-8000-000000000001',
  subject_id: '10000000-0000-4000-8000-000000000001',
  academic_group_id: '20000000-0000-4000-8000-000000000001',
};

async function withApp(run, { grants = {}, failure = undefined } = {}) {
  const queries = [];
  const pool = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes('FROM role_permissions')) {
        return { rows: (grants[params[0]] ?? []).map((permission) => ({ permission })) };
      }
      if (text.includes('INSERT INTO teacher_academic_habilitations')) {
        if (failure === 'duplicate') throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'teacher_habilitations_one_active_context' });
        if (failure === 'missing-context') throw Object.assign(new Error('missing context'), { code: '23503', constraint: 'teacher_habilitations_context_fk' });
        if (failure === 'actor-fk') throw Object.assign(new Error('actor FK'), { code: '23503', constraint: 'teacher_academic_habilitations_activated_by_fkey' });
        if (failure === 'unknown') throw new Error('database details must not leak');
        return { rows: [{
          id: '50000000-0000-4000-8000-000000000001',
          teacher_id: params[0], subject_id: params[1], academic_group_id: params[2], activated_by: params[3],
          activated_at: new Date('2026-04-05T06:07:08Z'), revoked_by: null, revoked_at: null,
        }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const server = createServer(createApp(pool));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const service = new JwtTokenService({ secret: SYNTHETIC_CONFIG.JWT_SECRET, secretKid: 'test-key', previousSecrets: [], expiresIn: '1h' });
  try {
    await run(`http://127.0.0.1:${server.address().port}`, service, queries);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function postOptions(token, body = INPUT) {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function token(service, role, sub, claimedPermissions = []) {
  return service.sign({ role, sub, permissions: claimedPermissions });
}

test('fresh matrix controls delegation on the same token; admin has no bypass and claims are not authority', async () => {
  const grants = { admin: [], delegate: [] };
  await withApp(async (base, service, queries) => {
    const admin = await token(service, 'admin', '40000000-0000-4000-8000-000000000001', ['teacher-habilitations:write']);
    assert.equal((await fetch(`${base}/teacher-habilitations`, postOptions(admin))).status, 403);
    const delegated = await token(service, 'delegate', '40000000-0000-4000-8000-000000000002');
    const options = postOptions(delegated, { ...INPUT, activated_by: 'spoof', activated_at: '2000-01-01T00:00:00Z' });
    assert.equal((await fetch(`${base}/teacher-habilitations`, options)).status, 403);
    grants.delegate = ['teacher-habilitations:write'];
    const created = await fetch(`${base}/teacher-habilitations`, options);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).activated_by, '40000000-0000-4000-8000-000000000002');
    grants.delegate = [];
    assert.equal((await fetch(`${base}/teacher-habilitations`, options)).status, 403);
    assert.equal(queries.filter(({ text }) => text.includes('INSERT INTO teacher_academic_habilitations')).length, 1);
  }, { grants });
});

test('missing or malformed verified actor and invalid body are denied before audited insertion', async () => {
  const grants = { admin: ['teacher-habilitations:write'] };
  await withApp(async (base, service, queries) => {
    const missingActor = await token(service, 'admin', undefined, ['teacher-habilitations:write']);
    assert.equal((await fetch(`${base}/teacher-habilitations`, postOptions(missingActor))).status, 401);
    const malformedActor = await token(service, 'admin', 'not-a-uuid', ['teacher-habilitations:write']);
    assert.equal((await fetch(`${base}/teacher-habilitations`, postOptions(malformedActor))).status, 401);
    const actor = await token(service, 'admin', '40000000-0000-4000-8000-000000000001');
    assert.equal((await fetch(`${base}/teacher-habilitations`, postOptions(actor, null))).status, 400);
    assert.equal((await fetch(`${base}/teacher-habilitations`, postOptions(actor, { ...INPUT, subject_id: 'bad' }))).status, 400);
    assert.equal(queries.filter(({ text }) => text.includes('INSERT INTO teacher_academic_habilitations')).length, 0);
  }, { grants });
});

test('duplicate, missing context, unexpected actor FK, and other failures are distinguished', async () => {
  const grants = { admin: ['teacher-habilitations:write'] };
  for (const [failure, expected] of [['duplicate', 409], ['missing-context', 404], ['actor-fk', 500], ['unknown', 500]]) {
    await withApp(async (base, service, queries) => {
      const actor = await token(service, 'admin', '40000000-0000-4000-8000-000000000001');
      const response = await fetch(`${base}/teacher-habilitations`, postOptions(actor));
      assert.equal(response.status, expected);
      if (failure === 'actor-fk' || failure === 'unknown') {
        assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
      }
      assert.equal(queries.filter(({ text }) => text.includes('INSERT INTO teacher_academic_habilitations')).length, 1);
    }, { grants, failure });
  }
});
