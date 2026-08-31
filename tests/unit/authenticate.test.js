import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.ts';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';

function createFakeTokenService(overrides = {}) {
  return {
    async verify(token) {
      if (overrides.throwError) {
        throw overrides.throwError;
      }
      return overrides.decoded ?? { role: 'estudiante', permissions: ['profile:read'] };
    },
  };
}

function createContext({ headers = {} } = {}) {
  const req = { headers };
  const state = { calls: [] };
  const res = {};
  const next = (error) => {
    state.calls.push(error);
  };
  return { req, res, next, state };
}

test('valid Bearer token exposes role, permissions, sub and userId on req.auth', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer valid-token' },
  });
  const middleware = authenticate(
    createFakeTokenService({
      decoded: { role: 'estudiante', permissions: ['profile:read'], sub: 'uuid-1' },
    }),
  );

  await middleware(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0], undefined); // next() with no error
  assert.deepEqual(req.auth, {
    role: 'estudiante',
    permissions: ['profile:read'],
    sub: 'uuid-1',
    userId: 'uuid-1',
  });
});

test('a token without a sub claim leaves both sub and userId absent', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer no-sub-token' },
  });
  // A decoded userId claim must NOT be promoted: the spec pins that the
  // subject is exposed only when the token actually carries `sub`.
  const middleware = authenticate(
    createFakeTokenService({
      decoded: { role: 'estudiante', permissions: ['profile:read'], userId: 'stale-id' },
    }),
  );

  await middleware(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0], undefined);
  assert.equal(req.auth.sub, undefined);
  assert.equal(req.auth.userId, undefined);
  assert.deepEqual(req.auth, { role: 'estudiante', permissions: ['profile:read'] });
});

test('missing Authorization header rejects with 401 and does not call verify', async () => {
  const service = createFakeTokenService();
  let verified = false;
  const originalVerify = service.verify.bind(service);
  service.verify = async () => {
    verified = true;
    return originalVerify();
  };

  const { req, res, next, state } = createContext({ headers: {} });
  await authenticate(service)(req, res, next);

  assert.equal(verified, false);
  assert.equal(state.calls.length, 1);
  assert.ok(state.calls[0] instanceof UnauthorizedError);
});

test('non-Bearer Authorization header rejects with 401', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Basic abc123' },
  });
  await authenticate(createFakeTokenService())(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.ok(state.calls[0] instanceof UnauthorizedError);
});

test('a malformed token rejects with 401 and req.auth is not set', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer not.a.token' },
  });
  await authenticate(
    createFakeTokenService({ throwError: new Error('invalid signature') }),
  )(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.ok(state.calls[0] instanceof UnauthorizedError);
  assert.equal(state.calls[0].statusCode, 401);
  assert.equal(req.auth, undefined);
});

test('an expired token rejects with the same generic 401', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer expired-token' },
  });
  await authenticate(createFakeTokenService({ throwError: new Error('jwt expired') }))(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.ok(state.calls[0] instanceof UnauthorizedError);
  assert.equal(state.calls[0].message, 'Invalid or missing token');
});
