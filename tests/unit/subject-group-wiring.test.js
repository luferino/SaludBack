import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Complete synthetic configuration before importing the app; no dotenv or DB runtime is used.
const SYNTHETIC_CONFIG = {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect',
  JWT_SECRET: 'synthetic-subject-group-wiring-secret-not-used-outside-tests',
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

const SUBJECT_ID = '10000000-0000-4000-8000-000000000001';
const GROUP_ID = '20000000-0000-4000-8000-000000000002';

async function withApp(run, { grants = {}, failPermissionRead = false, failure = undefined } = {}) {
  let fail = failPermissionRead;
  const queries = [];
  const pool = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes('FROM role_permissions')) {
        if (fail) throw new Error('permission reader unavailable');
        return { rows: (grants[params[0]] ?? []).map((permission) => ({ permission })) };
      }
      if (text.includes('INSERT INTO subject_academic_groups')) {
        if (failure === 'duplicate') throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'subject_academic_groups_pkey' });
        if (failure === 'missing-subject') throw Object.assign(new Error('missing'), { code: '23503', constraint: 'subject_academic_groups_subject_id_fkey' });
        if (failure === 'unknown') throw new Error('database details must not leak');
        return { rows: [{ subject_id: params[0], academic_group_id: params[1], created_by: params[2], created_at: new Date('2026-03-04T05:06:07Z') }] };
      }
      if (text.includes('FROM subject_academic_groups')) {
        return { rows: [{ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: null, created_at: new Date('2026-03-04T05:06:07Z') }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const server = createServer(createApp(pool));
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
function postOptions(tokenValue, body = { subject_id: SUBJECT_ID, academic_group_id: GROUP_ID }) {
  return { method: 'POST', headers: { ...auth(tokenValue), 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test('production wiring enforces fresh independent read/write grants and permits delegation', async () => {
  const grants = { reader: ['subject-groups:read'], writer: ['subject-groups:write'], delegate: [] };
  await withApp(async (base, service, queries) => {
    const reader = await token(service, 'reader', 'reader-1', ['subject-groups:read', 'subject-groups:write']);
    assert.equal((await fetch(`${base}/subject-groups`, { headers: auth(reader) })).status, 200);
    assert.equal((await fetch(`${base}/subject-groups`, { headers: auth(reader) })).status, 200);
    assert.equal((await fetch(`${base}/subject-groups`, { method: 'POST', ...postOptions(reader) })).status, 403);
    const writer = await token(service, 'writer', 'writer-1', ['subject-groups:read']);
    const created = await fetch(`${base}/subject-groups`, postOptions(writer, { subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: 'spoofed' }));
    assert.equal(created.status, 201);
    assert.equal((await created.json()).created_by, 'writer-1');
    assert.equal((await fetch(`${base}/subject-groups`, { headers: auth(writer) })).status, 403);
    const delegate = await token(service, 'delegate', 'delegate-1');
    assert.equal((await fetch(`${base}/subject-groups`, postOptions(delegate))).status, 403);
    grants.delegate = ['subject-groups:write', 'subject-groups:read'];
    assert.equal((await fetch(`${base}/subject-groups`, postOptions(delegate))).status, 201);
    assert.equal((await fetch(`${base}/subject-groups`, { headers: auth(delegate) })).status, 200);
    assert.equal(queries.filter(({ text }) => text.includes('FROM role_permissions')).length, 8);
    assert.equal(queries.filter(({ text }) => text.includes('INSERT INTO subject_academic_groups')).length, 2);
  }, { grants });
});

test('admin has no bypass, token claims are stale authority, revocation applies on the same token, and checks precede persistence', async () => {
  const grants = {};
  await withApp(async (base, service, queries) => {
    const admin = await token(service, 'admin', 'admin-1', ['subject-groups:write', 'subject-groups:read']);
    assert.equal((await fetch(`${base}/subject-groups`, { headers: auth(admin) })).status, 403);
    assert.equal((await fetch(`${base}/subject-groups`, postOptions(admin))).status, 403);
    const delegate = await token(service, 'delegate', 'delegate-1', []);
    grants.delegate = ['subject-groups:write'];
    const options = postOptions(delegate);
    assert.equal((await fetch(`${base}/subject-groups`, options)).status, 201);
    grants.delegate = [];
    assert.equal((await fetch(`${base}/subject-groups`, options)).status, 403);
    const writes = queries.map(({ text }, index) => text.includes('INSERT INTO subject_academic_groups') ? index : -1).filter((index) => index >= 0);
    assert.equal(writes.length, 1);
    assert.ok(writes[0] > 2, 'permission lookup must precede the allowed use case');
    assert.ok(queries.slice(0, 2).every(({ text }) => text.includes('FROM role_permissions')));
  }, { grants });
});

test('verified nullable actor is retained and body attribution never enters SQL', async () => {
  const grants = { admin: ['subject-groups:write'] };
  await withApp(async (base, service, queries) => {
    const admin = await token(service, 'admin', undefined, ['subject-groups:write']);
    const response = await fetch(`${base}/subject-groups`, postOptions(admin, { subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: 'spoof', createdBy: 'spoof' }));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).created_by, null);
    const insert = queries.find(({ text }) => text.includes('INSERT INTO subject_academic_groups'));
    assert.deepEqual(insert.params, [SUBJECT_ID, GROUP_ID, null]);
  }, { grants });
});

test('permission-read failures and repository duplicate, missing-reference, and unexpected errors use standard responses', async () => {
  const grants = { admin: ['subject-groups:write'] };
  for (const [failure, expected] of [['duplicate', 409], ['missing-subject', 404], ['unknown', 500]]) {
    await withApp(async (base, service) => {
      const admin = await token(service, 'admin', 'admin-1', ['subject-groups:write']);
      const response = await fetch(`${base}/subject-groups`, postOptions(admin));
      assert.equal(response.status, expected);
      if (failure === 'unknown') assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
    }, { grants, failure });
  }
  await withApp(async (base, service, queries) => {
    const reader = await token(service, 'reader', 'reader-1');
    assert.equal((await fetch(`${base}/subject-groups`, { headers: auth(reader) })).status, 500);
    assert.equal(queries.length, 1);
  }, { failPermissionRead: true });
});
