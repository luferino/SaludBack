import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetCurrentUser } from '../../src/modules/auth/application/get-current-user.usecase.ts';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';

test('returns exactly username, email and role for an existing user (PR-001)', async () => {
  // The stored row carries a hash and audit values; none of them may leak
  // into the narrow CurrentUserOutput (PR-001: exactly three keys).
  const useCase = new GetCurrentUser({
    repository: {
      findById: async () =>
        new User({
          id: 'uuid-1',
          username: 'jperez',
          passwordHash: 'secret-hash',
          role: 'estudiante',
          email: 'jperez@example.com',
          createdAt: new Date('2026-08-05T12:00:00Z'),
          createdBy: 'actor-1',
          updatedBy: 'actor-2',
          updatedAt: new Date('2026-08-06T12:00:00Z'),
        }),
    },
  });

  const result = await useCase.execute({ userId: 'uuid-1' });
  assert.deepEqual(Object.keys(result).sort(), ['email', 'role', 'username']);
  assert.deepEqual(result, { username: 'jperez', email: 'jperez@example.com', role: 'estudiante' });
  assert.equal('passwordHash' in result, false);
  assert.equal('id' in result, false);
  assert.equal('createdBy' in result, false);
});

test('keeps email null for an account without an email (profile-less admin shape)', async () => {
  const useCase = new GetCurrentUser({
    repository: {
      findById: async () =>
        new User({ username: 'ADMINBOOT', passwordHash: 'not-a-real-hash', role: 'admin' }),
    },
  });

  const result = await useCase.execute({ userId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });
  assert.deepEqual(result, { username: 'ADMINBOOT', email: null, role: 'admin' });
  assert.deepEqual(Object.keys(result).sort(), ['email', 'role', 'username']);
});

test('throws UnauthorizedError (401) when the user id matches no row (PR-002)', async () => {
  const useCase = new GetCurrentUser({ repository: { findById: async () => null } });

  await assert.rejects(
    () => useCase.execute({ userId: 'ghost-id' }),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, 'UNAUTHORIZED');
      return true;
    },
  );
});

test('throws UnauthorizedError (401) without touching the database when no user id is present', async () => {
  let reads = 0;
  const useCase = new GetCurrentUser({
    repository: {
      findById: async () => {
        reads += 1;
        return null;
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ userId: undefined }),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.statusCode, 401);
      return true;
    },
  );
  assert.equal(reads, 0, 'a missing identity must not trigger a database read');
});