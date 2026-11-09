import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createReceptionRouter } from '../../src/modules/reception/infrastructure/routes/reception.routes.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';

const ACTOR = '40000000-0000-4000-8000-000000000001';
const USER = '40000000-0000-4000-8000-000000000002';
const GRANT = '50000000-0000-4000-8000-000000000001';
async function serve(auth, run) {
  const calls = [];
  const repository = {
    async createAccount(user) { calls.push(['create', user]); return new User({ ...user, id: USER, createdAt: '2026-06-01T00:00:00Z' }); },
    async listGrants(...args) { calls.push(['list', ...args]); return []; },
    async grantCareer(...args) { calls.push(['grant', ...args]); throw new Error('unexpected write'); },
    async revokeGrant(...args) { calls.push(['revoke', ...args]); throw new Error('unexpected write'); },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = auth; next(); });
  const hasher = { async hash(value) { calls.push(['hash', value]); return 'secret-hash'; } };
  app.use('/auth', createReceptionRouter({ repository, hasher, surface: 'admin' }));
  app.use('/reception', createReceptionRouter({ repository, hasher, surface: 'self' }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, calls); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const send = (base, path, method = 'GET', body) => fetch(base + path, {
  method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const permissions = ['reception:accounts:write', 'reception:careers:write', 'reception:careers:read'];
const adminPaths = [
  ['/auth/accounts', 'POST', { username: 'Desk01', password: 'healthy1234', email: 'desk@example.com' }],
  [`/auth/accounts/${USER}/careers`, 'GET'],
  [`/auth/accounts/${USER}/careers`, 'POST', { career: 'kinesiology' }],
  [`/auth/career-grants/${GRANT}/revoke`, 'POST'],
];
test('Reception cannot provision accounts or manage grants even with admin permissions', async () => {
  await serve({ userId: ACTOR, role: 'reception', permissions }, async (base, calls) => {
    for (const [path, method, body] of adminPaths) {
      const response = await send(base, path, method, body);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: 'Admin role required' } });
    }
    assert.deepEqual(calls, []);
  });
});
test('admin without dedicated permissions cannot invoke any Reception administration', async () => {
  await serve({ userId: ACTOR, role: 'admin', permissions: [] }, async (base, calls) => {
    for (const [path, method, body] of adminPaths) {
      const response = await send(base, path, method, body);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'FORBIDDEN');
    }
    assert.deepEqual(calls, []);
  });
});
test('provisioning forces Reception and server actor; response never leaks password or audit fields', async () => {
  await serve({ userId: ACTOR, role: 'admin', permissions }, async (base, calls) => {
    const response = await send(base, '/auth/accounts', 'POST', {
      username: ' Desk01 ', password: 'healthy1234', email: ' Desk@example.com ',
      role: 'admin', createdBy: USER, careers: ['kinesiology','odontology'],
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: USER, username: 'DESK01', email: 'Desk@example.com', role: 'reception', createdAt: '2026-06-01T00:00:00Z' });
    assert.equal(calls[1][1].createdBy, ACTOR);
    assert.equal(calls[1][1].passwordHash, 'secret-hash');
    assert.deepEqual(calls.map(([kind]) => kind), ['hash', 'create']);
  });
});
test('zero active grants yields no options; self endpoint never accepts another account from query', async () => {
  await serve({ userId: ACTOR, role: 'reception', permissions }, async (base, calls) => {
    const response = await send(base, `/reception/careers?userId=${USER}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { careers: [] });
    assert.deepEqual(calls, [['list', ACTOR, true]]);
  });
});
test('self options require a verified UUID actor before consulting grants', async () => {
  await serve({ userId: 'invalid', role: 'reception', permissions }, async (base, calls) => {
    const response = await send(base, '/reception/careers');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: 'UNAUTHORIZED', message: 'A verified UUID actor is required' } });
    assert.deepEqual(calls, []);
  });
});
test('invalid career or path identifiers reject without repository calls', async () => {
  await serve({ userId: ACTOR, role: 'admin', permissions }, async (base, calls) => {
    for (const [path, method, body, message] of [
      ['/auth/accounts/not-uuid/careers','GET',null,'userId must be a UUID'],
      ['/auth/career-grants/not-uuid/revoke','POST',null,'grantId must be a UUID'],
      [`/auth/accounts/${USER}/careers`,'POST',{career:'unknown'},'career must be kinesiology or odontology'],
    ]) {
      const response = await send(base, path, method, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
    }
    assert.deepEqual(calls, []);
  });
});

test('malformed account field types fail before hashing or writes', async () => {
  await serve({ userId: ACTOR, role: 'admin', permissions }, async (base, calls) => {
    const valid = { username: 'Desk01', password: 'healthy1234', email: 'desk@example.com' };
    for (const [field, value] of [['username', 12], ['password', ['healthy1234']], ['email', {}]]) {
      const response = await send(base, '/auth/accounts', 'POST', { ...valid, [field]: value });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: field + ' must be a string' } });
      assert.deepEqual(calls, []);
    }
  });
});
