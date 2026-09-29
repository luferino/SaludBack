import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.ts';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';

/**
 * PG-001 — DB wins. A valid Bearer token exposes role, sub and userId on
 * req.auth; the `permissions` come from the injected permission-matrix
 * reader (permissionsForRole -> seeded role_permissions grants), which
 * REPLACES the token's claim. A matrix-read failure is propagated UNCHANGED
 * (fail closed -> 500, never a fabricated 401).
 */

const DB_ESTUDIANTE_PERMISSIONS = ['profile:read', 'materias:read', 'turnos:read'];
const DB_ESTUDIANTE_PERMISSIONS_LOCAL = DB_ESTUDIANTE_PERMISSIONS;

function createFakeTokenService({ decoded = { role: 'estudiante', permissions: ['profile:read'], sub: 'uuid-1' } } = {}) {
  return {
    async verify() {
      return decoded;
    },
  };
}

function createFakeMatrixReader({ permissions = DB_ESTUDIANTE_PERMISSIONS_LOCAL } = {}) {
  return {
    async permissionsForRole() {
      return permissions;
    },
  };
}

function createContext({ headers = {} } = {}) {
  const req = { headers };
  const res = {};
  const state = { calls: [] };
  const next = (error) => {
    state.calls.push(error);
  };
  return { req, res, next, state };
}

test('valid Bearer token exposes role, permissions, sub and userId on req.auth (DB wins)', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer valid-token' },
  });
  const middleware = authenticate(
    createFakeTokenService({
      decoded: {
        role: 'estudiante',
        permissions: ['profile:read'], // claim is advisory; DB wins
        sub: 'uuid-1',
      },
    }),
    createFakeMatrixReader({ permissions: DB_ESTUDIANTE_PERMISSIONS_LOCAL }),
  );

  await middleware(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0], undefined); // next() with no error
  assert.deepEqual(req.auth.permissions, DB_ESTUDIANTE_PERMISSIONS_LOCAL);
  assert.equal(req.auth.role, 'estudiante');
  assert.equal(req.auth.sub, 'uuid-1');
  assert.equal(req.auth.userId, 'uuid-1');
});

test('a token without a sub claim leaves both sub and userId absent while DB permissions win', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer no-sub-token' },
  });
  const middleware = authenticate(
    createFakeTokenService({
      decoded: { role: 'estudiante', permissions: ['profile:read'] }, // no sub
    }),
    createFakeMatrixReader({ permissions: DB_ESTUDIANTE_PERMISSIONS_LOCAL }),
  );

  await middleware(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0], undefined);
  assert.equal(req.auth.sub, undefined);
  assert.equal(req.auth.userId, undefined);
  assert.deepEqual(req.auth.permissions, DB_ESTUDIANTE_PERMISSIONS_LOCAL);
});

test('the matrix answer replaces even a richer token permissions claim (DB wins)', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer scoped-token' },
  });
  const middleware = authenticate(
    createFakeTokenService({
      decoded: { role: 'profesor', permissions: ['profile:read', 'students:write', 'server:admin'], sub: 'uuid-2' },
    }),
    createFakeMatrixReader({ permissions: DB_ESTUDIANTE_PERMISSIONS_LOCAL }),
  );

  await middleware(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0], undefined);
  assert.deepEqual(req.auth.permissions, DB_ESTUDIANTE_PERMISSIONS_LOCAL);
  assert.equal(req.auth.role, 'profesor');
  assert.equal(req.auth.sub, 'uuid-2');
  assert.equal(req.auth.userId, 'uuid-2');
});

test('a matrix-read failure is propagated unchanged (fail closed -> 500, not 401)', async () => {
  const { req, res, next, state } = createContext({
    headers: { authorization: 'Bearer valid-token' },
  });
  const matrixFailure = new Error('matrix unavailable');
  const middleware = authenticate(
    createFakeTokenService({
      decoded: { role: 'estudiante', permissions: ['profile:read'], sub: 'uuid-1' },
    }),
    {
      async permissionsForRole() {
        throw matrixFailure;
      },
    },
  );

  await middleware(req, res, next);

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0], matrixFailure); // unchanged -> 500, not 401
});
