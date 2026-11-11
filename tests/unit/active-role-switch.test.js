import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { createActiveRoleAdminRouter } from '../../src/modules/auth/infrastructure/routes/active-role.routes.ts';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.ts';
import { LoginUser } from '../../src/modules/auth/application/login-user.usecase.ts';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';

const USER = '40000000-0000-4000-8000-000000000002';
const GRANT = '50000000-0000-4000-8000-000000000001';

async function withServer(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.auth = { sub: USER, userId: USER, username: 'STUDENT1', role: 'estudiante', permissions: ['student:read'] }; next(); });
  app.use('/auth', createActiveRoleAdminRouter({
    repository,
    users: { async findById() { return { id: USER, username: 'STUDENT1', role: 'estudiante' }; } },
    tokenService: { async sign(claims) { return JSON.stringify(claims); } },
    matrixReader: { async permissionsForRole(role) { return role === 'reception' ? ['reception:patients:manage'] : ['student:read']; } },
  }));
  app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/auth`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function repository({ currentRoleValid = true } = {}) {
  const calls = [];
  return {
    calls,
    async isValidActiveRole(...args) { calls.push(args); return currentRoleValid; },
    async availableRoles() { return ['estudiante', 'reception']; },
    async activeReceptionRoleGrant() { return { id: GRANT }; },
  };
}
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('role discovery and explicit switch issue one-role tokens with stable identity and exact grant instance', async () => {
  await withServer(repository(), async base => {
    const discovery = await fetch(`${base}/roles`);
    assert.equal(discovery.status, 200);
    assert.deepEqual(await discovery.json(), { active_role: 'estudiante', available_roles: ['estudiante', 'reception'] });
    const switched = await fetch(`${base}/active-role`, post({ role: 'reception' }));
    assert.equal(switched.status, 200);
    const result = await switched.json();
    assert.deepEqual(JSON.parse(result.token), {
      sub: USER, username: 'STUDENT1', role: 'reception', permissions: ['reception:patients:manage'], role_grant_id: GRANT,
    });
    const primary = await fetch(`${base}/active-role`, post({ role: 'estudiante' }));
    assert.equal(primary.status, 200);
    assert.deepEqual(JSON.parse((await primary.json()).token), {
      sub: USER, username: 'STUDENT1', role: 'estudiante', permissions: ['student:read'],
    });
    assert.equal((await fetch(`${base}/active-role`, post({ role: 'admin' }))).status, 403);
    assert.equal((await fetch(`${base}/active-role`, post({ role: 'reception', extra: true }))).status, 400);
  });
});

test('role discovery and switching reject a stale current membership before reading or issuing another role', async () => {
  const repo = repository({ currentRoleValid: false });
  await withServer(repo, async base => {
    const discovery = await fetch(`${base}/roles`);
    assert.equal(discovery.status, 401);
    const switched = await fetch(`${base}/active-role`, post({ role: 'reception' }));
    assert.equal(switched.status, 401);
  });
  assert.deepEqual(repo.calls, [[USER, 'estudiante', undefined], [USER, 'estudiante', undefined]]);
});

test('public protected route rejects revoked or mismatched grant instances, and exposes database faults as 500', async () => {
  async function requestFor(claims, liveReader) {
    const app = express();
    app.use('/secure', authenticate({ async verify() { return claims; } }, { async permissionsForRole() { return ['reception:patients:manage']; } }, liveReader),
      (req, res) => res.json({ role: req.auth.role, grant: req.auth.roleGrantId }));
    app.use(errorHandler);
    const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/secure`, { headers: { authorization: 'Bearer test' } });
      return { status: response.status, body: await response.json() };
    } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }
  const claims = { sub: USER, username: 'STUDENT1', role: 'reception', role_grant_id: GRANT };
  assert.deepEqual(await requestFor(claims, { async isValidActiveRole(id, role, grantId) {
    assert.deepEqual([id, role, grantId], [USER, 'reception', GRANT]); return true;
  } }), { status: 200, body: { role: 'reception', grant: GRANT } });
  const revoked = await requestFor(claims, { async isValidActiveRole() { return false; } });
  assert.equal(revoked.status, 401); assert.deepEqual(revoked.body.error, { code: 'UNAUTHORIZED', message: 'Invalid or missing token' });
  const fault = await requestFor(claims, { async isValidActiveRole() { throw new Error('database unavailable'); } });
  assert.equal(fault.status, 500); assert.deepEqual(fault.body.error, { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
  const malformed = await requestFor({ ...claims, role_grant_id: 'forged' }, { async isValidActiveRole() { assert.fail('must reject before DB'); } });
  assert.equal(malformed.status, 401);
});

test('a token issued by the real login use case switches roles through authenticate', async () => {
  const repo = repository();
  const tokenService = new JwtTokenService({ secret: 'active-role-switch-test-secret', expiresIn: '5m' });
  const matrixReader = { async permissionsForRole(role) { return role === 'reception' ? ['reception:patients:manage'] : ['student:read']; } };
  const login = new LoginUser({
    repository: { async findByUsername() { return new User({ id: USER, username: 'STUDENT1', passwordHash: 'stored-hash', role: 'estudiante' }); } },
    hasher: { async compare(plain, hash) { return plain === 'correct-password' && hash === 'stored-hash'; } },
    tokenService,
    matrixReader,
  });
  const { token: loginToken } = await login.execute({ username: 'student1', password: 'correct-password' });
  const tokenWithoutUsername = await tokenService.sign({ sub: USER, role: 'estudiante', permissions: [] });
  const app = express(); app.use(express.json());
  app.use('/auth', createActiveRoleAdminRouter({
    repository: repo, authenticate: authenticate(tokenService, matrixReader, repo), tokenService, matrixReader,
  }));
  app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const switchAs = token => fetch(`http://127.0.0.1:${server.address().port}/auth/active-role`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'reception' }),
    });
    const switched = await switchAs(loginToken);
    assert.equal(switched.status, 200);
    const claims = await tokenService.verify((await switched.json()).token);
    assert.deepEqual([claims.sub, claims.username, claims.role, claims.permissions, claims.role_grant_id],
      [USER, 'STUDENT1', 'reception', ['reception:patients:manage'], GRANT]);
    const withoutUsername = await switchAs(tokenWithoutUsername);
    assert.equal(withoutUsername.status, 401);
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
