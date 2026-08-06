import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginUser } from '../../src/modules/auth/application/login-user.js';
import { User } from '../../src/modules/auth/domain/user.js';
import { ROLE_PERMISSIONS } from '../../src/modules/auth/domain/permissions.js';
import { BadRequestError, UnauthorizedError } from '../../src/modules/shared/domain/errors.js';

const EXISTING_USER = new User({
  id: 'uuid-1',
  username: 'jperez',
  passwordHash: 'hashed:secret123',
  role: 'estudiante',
});

function createFakes({ user = EXISTING_USER, passwordMatches = true } = {}) {
  const calls = { findByUsername: [], compare: [], sign: [] };
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
      return `signed-token:${claims.username}`;
    },
  };
  return { repository, hasher, tokenService, calls };
}

test('successful login returns a token signed with role-derived claims', async () => {
  const { repository, hasher, tokenService, calls } = createFakes();
  const useCase = new LoginUser({ repository, hasher, tokenService });

  const result = await useCase.execute({ username: 'jperez', password: 'secret123' });

  assert.equal(result.token, 'signed-token:jperez');
  assert.deepEqual(calls.sign[0], {
    sub: 'uuid-1',
    username: 'jperez',
    role: 'estudiante',
    permissions: ROLE_PERMISSIONS.estudiante,
  });
});

test('unknown username throws a generic UnauthorizedError and never signs', async () => {
  const { repository, hasher, tokenService, calls } = createFakes({ user: null });
  const useCase = new LoginUser({ repository, hasher, tokenService });

  await assert.rejects(
    () => useCase.execute({ username: 'ghost', password: 'whatever' }),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.message, 'Invalid credentials');
      return true;
    },
  );
  assert.equal(calls.compare.length, 0);
  assert.equal(calls.sign.length, 0);
});

test('wrong password throws the same generic UnauthorizedError and never signs', async () => {
  const { repository, hasher, tokenService, calls } = createFakes({ passwordMatches: false });
  const useCase = new LoginUser({ repository, hasher, tokenService });

  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: 'wrong-pass' }),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.message, 'Invalid credentials');
      return true;
    },
  );
  assert.equal(calls.sign.length, 0);
});

test('missing or empty username throws BadRequestError', async () => {
  const { repository, hasher, tokenService } = createFakes();
  const useCase = new LoginUser({ repository, hasher, tokenService });
  await assert.rejects(() => useCase.execute({ password: 'secret123' }), BadRequestError);
  await assert.rejects(() => useCase.execute({ username: '   ', password: 'secret123' }), BadRequestError);
});

test('missing or empty password throws BadRequestError', async () => {
  const { repository, hasher, tokenService } = createFakes();
  const useCase = new LoginUser({ repository, hasher, tokenService });
  await assert.rejects(() => useCase.execute({ username: 'jperez' }), BadRequestError);
  await assert.rejects(() => useCase.execute({ username: 'jperez', password: '' }), BadRequestError);
});
