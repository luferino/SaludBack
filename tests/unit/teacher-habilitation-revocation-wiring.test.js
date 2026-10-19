import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
Object.assign(process.env, {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect', JWT_SECRET: 'synthetic-revocation-public-secret',
  CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'test-key', JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3',
});
const { createApp } = await import('../../src/app.ts');
const { JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts');

test('public revocation preserves audit facts and period isolation while reloading delegated grants', async () => {
  const actor = '40000000-0000-4000-8000-000000000001';
  const other = '40000000-0000-4000-8000-000000000002';
  const input = { teacher_id: '30000000-0000-4000-8000-000000000001', subject_id: '10000000-0000-4000-8000-000000000001', academic_group_id: '20000000-0000-4000-8000-000000000001' };
  const grants = { admin: [], delegate: [], writer: ['teacher-habilitations:write'] };
  const rows = new Map();
  const counters = { inserts: 0, updates: 0 };
  let failActor = false;
  const pool = { async query(text, params = []) {
    if (text.includes('FROM role_permissions')) return { rows: (grants[params[0]] ?? []).map((permission) => ({ permission })) };
    if (text.includes('INSERT INTO teacher_academic_habilitations')) {
      const id = `50000000-0000-4000-8000-${String(++counters.inserts).padStart(12, '0')}`;
      const row = { id, teacher_id: params[0], subject_id: params[1], academic_group_id: params[2], activated_by: params[3], activated_at: '2026-04-05T06:07:08.000Z', revoked_by: null, revoked_at: null };
      rows.set(id, row);
      return { rows: [{ ...row }] };
    }
    if (text.includes('UPDATE teacher_academic_habilitations')) {
      assert.match(text, /WHERE id = \$1/);
      assert.match(text, /revoked_by = CASE WHEN revoked_at IS NULL THEN \$2 ELSE revoked_by END/);
      assert.match(text, /revoked_at = CASE WHEN revoked_at IS NULL/);
      counters.updates++;
      if (failActor) throw Object.assign(new Error('synthetic private FK detail'), { code: '23503', constraint: 'teacher_academic_habilitations_revoked_by_fkey' });
      const row = rows.get(params[0]);
      if (!row) return { rows: [] };
      if (row.revoked_at === null) Object.assign(row, { revoked_by: params[1], revoked_at: '2026-04-05T06:07:09.000Z' });
      return { rows: [{ ...row }] };
    }
    throw new Error(`Unexpected fake query: ${text}`);
  } };
  const service = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: 'test-key', previousSecrets: [], expiresIn: '1h' });
  const admin = await service.sign({ role: 'admin', sub: actor, permissions: ['teacher-habilitations:revoke'] });
  const delegate = await service.sign({ role: 'delegate', sub: actor });
  const secondActor = await service.sign({ role: 'delegate', sub: other });
  const writer = await service.sign({ role: 'writer', sub: actor });
  const server = createServer(createApp(pool));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = async (path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/teacher-habilitations${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const snapshot = () => JSON.stringify({ rows: [...rows], counters });
  const deny = async (path, token, status, body) => {
    const before = snapshot();
    assert.deepEqual(await post(path, token), { status, body });
    assert.equal(snapshot(), before, 'rejection leaves stored state and mutation counters unchanged');
  };
  const forbidden = { error: { code: 'FORBIDDEN', message: "Permission 'teacher-habilitations:revoke' required" } };
  try {
    const first = await post('', writer, input);
    assert.equal(first.status, 201);
    const path = `/${first.body.id}/revoke`;
    await deny(path, admin, 403, forbidden);
    await deny(path, writer, 403, forbidden);
    await deny(path, delegate, 403, forbidden);
    grants.delegate = ['teacher-habilitations:revoke'];
    const revoked = await post(path, delegate, { revoked_by: other, revoked_at: '1999-01-01', teacher_id: 'spoof' });
    assert.deepEqual(revoked, { status: 200, body: { ...first.body, revoked_by: actor, revoked_at: '2026-04-05T06:07:09.000Z' } });
    assert.equal(counters.updates, 1);
    const beforeRepeat = JSON.stringify([...rows]);
    assert.deepEqual(await post(path, secondActor), revoked);
    assert.equal(JSON.stringify([...rows]), beforeRepeat);
    assert.equal(counters.updates, 2);
    const reactivated = await post('', writer, input);
    assert.equal(reactivated.status, 201);
    assert.notEqual(reactivated.body.id, first.body.id);
    assert.deepEqual(reactivated.body, { ...first.body, id: reactivated.body.id });
    assert.deepEqual(await post(path, secondActor), revoked);
    assert.deepEqual(rows.get(reactivated.body.id), reactivated.body);
    assert.equal(counters.updates, 3);
    grants.delegate = [];
    await deny(`/${reactivated.body.id}/revoke`, delegate, 403, forbidden);
    grants.delegate = ['teacher-habilitations:revoke'];
    failActor = true;
    const beforeFailure = JSON.stringify([...rows]);
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args);
    let failure;
    try { failure = await post(`/${reactivated.body.id}/revoke`, delegate); }
    finally { console.error = originalError; }
    assert.deepEqual(failure, { status: 500, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } } });
    assert.equal(logged.length, 1);
    assert.equal(JSON.stringify([...rows]), beforeFailure);
    assert.deepEqual(counters, { inserts: 2, updates: 4 });
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
