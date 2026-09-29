import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginUser } from '../../src/modules/auth/application/login-user.usecase.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';
import { UnauthorizedError, BadRequestError } from '../../src/modules/shared/domain/errors.ts';

/**
 * PG-001 — DB wins. The signed token's `permissions` claim is set from the
 * injected permission-matrix READER (permissionsForRole), which answers from
 * the seeded `role_permissions` grants (PG-001 seed) — NOT from any code
 * constant. The reader is consulted on EVERY login; a reader/DB failure is
 * propagated UNCHANGED (fail closed -> 500 at login, never a fabricated 401).
 */

const DB_ESTUDIANTE_PERMISSIONS = ['profile:read', 'materias:read', 'turnos:read'];
const DB_ESTUDIANTE_PERMISSIONS_LOCAL = DB_ESTUDIANTE_PERMISSIONS;

/** Fixture user seeded via the PG-001 story (role_permissions grants). */
const EXISTING_USER = new User({
  id: 'uuid-1',
  username: 'JPEREZ',
  passwordHash: 'hashed:secret12345',
  role: 'estudiante',
  email: 'jperez@example.com',
});

function createFakes({ user = EXISTING_USER, passwordMatches = false } = {}) {
  const calls = { findByUsername: [], compare: [], sign: [], permissionsForRole: [] };
  const repository = {
    async findByUsername(username) {
      calls.findByUsername.push(username);
      return user;
    },
  };
  const hasher = {
    async compare(plain, hash) {
      calls.compare.push([plain, hash]);
      return passwordMatches;
    },
  };
  const tokenService = {
    async sign(claims) {
      calls.sign.push(claims);
      return `signed:${claims.username}`;
    },
  };
  const matrixReader = {
    async permissionsForRole(role) {
      calls.permissionsForRole.push(role);
      return DB_ESTUDIANTE_PERMISSIONS_LOCAL;
    },
  };
  return { repository, hasher, tokenService, matrixReader, calls };
}

test('successful login embeds the DB permission-matrix answer into the signed claims (DB wins)', async () => {
  const { repository, hasher, tokenService, matrixReader, calls } = createFakes({
    user: EXISTING_USER,
    passwordMatches: true,
  });
  const useCase = new LoginUser({ repository, hasher, tokenService, matrixReader });

  const result = await useCase.execute({ username: 'JPEREZ', password: 'secret12345' });

  assert.equal(result.token, 'signed:JPEREZ');
  assert.equal(calls.permissionsForRole[0], EXISTING_USER.role);
  assert.deepEqual(calls.sign[0].permissions, DB_ESTUDIANTE_PERMISSIONS_LOCAL);
});

test('wrong password is rejected with UnauthorizedError and never signs token claims', async () => {
  const { repository, hasher, tokenService, matrixReader, calls } = createFakes({
    user: EXISTING_USER,
    passwordMatches: false,
  });
  const useCase = new LoginUser({ repository, hasher, tokenService, matrixReader });

  await assert.rejects(
    () => useCase.execute({ username: 'JPEREZ', password: 'secret12345' }),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.message, 'Invalid credentials');
      return true;
    },
  );
  assert.equal(calls.sign.length, 0);
  assert.equal(calls.permissionsForRole.length, 0);
});

test('username not found is rejected as UnauthorizedError and never consults the matrix reader', async () => {
  const { repository, hasher, tokenService, matrixReader, calls } = createFakes({
    user: null,
    passwordMatches: true,
  });
  const useCase = new LoginUser({ repository, hasher, tokenService, matrixReader });

  await assert.rejects(
    () => useCase.execute({ username: 'GHOST', password: 'secret12345' }),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.message, 'Invalid credentials');
      return true;
    },
  );
  assert.equal(calls.sign.length, 0);
  assert.equal(calls.permissionsForRole.length, 0);
});

test('a matrix-read failure is propagated unchanged (fail closed -> 500, not a fabricated 401)', async () => {
  const { repository, hasher, tokenService } = createFakes({
    user: EXISTING_USER,
    passwordMatches: true,
  });
  const matrixFailure = new Error('pool connection refused');
  const matrixReader = {
    async permissionsForRole() {
      throw matrixFailure;
    },
  };
  const useCase = new LoginUser({ repository, hasher, tokenService, matrixReader });

  await assert.rejects(
    () => useCase.execute({ username: 'JPEREZ', password: 'secret12345' }),
    (error) => {
      assert.equal(error, matrixFailure);
      return true;
    },
  );
});
