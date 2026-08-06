import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RegisterUser } from '../../src/modules/auth/application/register-user.js';
import { User } from '../../src/modules/auth/domain/user.js';
import { BadRequestError, ConflictError } from '../../src/modules/shared/domain/errors.js';

class FakeHasher {
  async hash(plain) {
    return `hashed:${plain}`;
  }
}

function createFakeRepository(overrides = {}) {
  const calls = { findByUsername: [], create: [] };
  return {
    calls,
    async findByUsername(username) {
      calls.findByUsername.push(username);
      return overrides.existing ?? null;
    },
    async create(user) {
      calls.create.push(user);
      return new User({ ...user, id: 'uuid-new', createdAt: new Date('2026-08-05T12:00:00Z') });
    },
  };
}

test('successful registration creates an estudiante with a hashed password', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({ username: 'jperez', password: 'secret123' });

  assert.equal(created.username, 'jperez');
  assert.equal(created.role, 'estudiante');
  assert.equal(created.passwordHash, 'hashed:secret123');
  assert.equal(repository.calls.findByUsername[0], 'jperez');
  assert.equal(repository.calls.create.length, 1);
});

test('duplicate username throws ConflictError and does not create', async () => {
  const repository = createFakeRepository({
    existing: new User({ username: 'jperez', passwordHash: 'x', role: 'estudiante' }),
  });
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: 'secret123' }),
    ConflictError,
  );
  assert.equal(repository.calls.create.length, 0);
});

test('missing or empty username throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  await assert.rejects(() => useCase.execute({ password: 'secret123' }), BadRequestError);
  await assert.rejects(() => useCase.execute({ username: '  ', password: 'secret123' }), BadRequestError);
});

test('missing or empty password throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  await assert.rejects(() => useCase.execute({ username: 'jperez' }), BadRequestError);
  await assert.rejects(() => useCase.execute({ username: 'jperez', password: '' }), BadRequestError);
});
