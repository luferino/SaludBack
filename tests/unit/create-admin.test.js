import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateAdmin } from '../../src/modules/auth/application/create-admin.usecase.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';
import { BadRequestError, ConflictError } from '../../src/modules/shared/domain/errors.ts';

class FakeHasher {
  async hash(plain) {
    return `hashed:${plain}`;
  }
}

function createFakeRepository(overrides = {}) {
  const calls = { findByUsername: [], findByEmail: [], create: [] };
  return {
    calls,
    async findByUsername(username) {
      calls.findByUsername.push(username);
      return overrides.existingByUsername ?? null;
    },
    async findByEmail(email) {
      calls.findByEmail.push(email);
      return overrides.existingByEmail ?? null;
    },
    async create(user) {
      calls.create.push(user);
      if (overrides.createThrows) throw overrides.createThrows;
      return new User({ ...user, id: 'uuid-admin', createdAt: new Date('2026-09-12T12:00:00Z') });
    },
  };
}

test('successful bootstrap creates an admin with a hashed password and normalized username', async () => {
  const repository = createFakeRepository();
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({ username: 'rootuser', password: 'Secret12345' });

  assert.equal(created.username, 'ROOTUSER');
  assert.equal(created.role, 'admin');
  assert.equal(created.passwordHash, 'hashed:Secret12345');
  assert.equal(created.email, null);
  assert.equal(repository.calls.findByUsername[0], 'ROOTUSER');
  assert.equal(repository.calls.create.length, 1);
});

test('bootstrap rejects a password below the shared strength rules (min 10, letter + digit)', async () => {
  const repository = createFakeRepository();
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });
  const cases = [
    ['short1', 'password must be at least 10 characters'],
    ['lettersonly', 'password must contain at least one letter and one number'],
    ['1234567890', 'password must contain at least one letter and one number'],
  ];
  for (const [password, message] of cases) {
    await assert.rejects(
      () => useCase.execute({ username: 'rootuser', password }),
      (error) => {
        assert.ok(error instanceof BadRequestError);
        assert.equal(error.message, message);
        return true;
      },
    );
  }
  assert.equal(repository.calls.create.length, 0);
});

test('bootstrap rejects an existing username with ConflictError and creates nothing', async () => {
  const repository = createFakeRepository({
    existingByUsername: new User({ username: 'ROOTUSER', passwordHash: 'x', role: 'admin' }),
  });
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () => useCase.execute({ username: 'rootuser', password: 'Secret12345' }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, 'username already exists: ROOTUSER');
      return true;
    },
  );
  assert.equal(repository.calls.create.length, 0);
});

test('bootstrap normalizes a lowercase username to uppercase before lookup', async () => {
  const repository = createFakeRepository();
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({ username: 'root', password: 'Secret12345' });

  assert.equal(created.username, 'ROOT');
  assert.equal(repository.calls.findByUsername[0], 'ROOT');
});

test('bootstrap with an invalid username (dot, dash, underscore, space) throws BadRequestError', async () => {
  const repository = createFakeRepository();
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });
  for (const invalid of ['root.user', 'root-user', 'root_user', 'root user', '']) {
    await assert.rejects(
      () => useCase.execute({ username: invalid, password: 'Secret12345' }),
      BadRequestError,
    );
  }
  assert.equal(repository.calls.create.length, 0);
});

/** Mimics a pg unique_violation error (SQLSTATE 23505) with its constraint name. */
function uniqueViolation(constraint, message) {
  return Object.assign(new Error(message), { code: '23505', constraint });
}

test('bootstrap maps a unique-violation race on username to ConflictError with a clean message', async () => {
  const repository = createFakeRepository({
    createThrows: uniqueViolation(
      'users_username_key',
      'duplicate key value violates unique constraint "users_username_key"',
    ),
  });
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () => useCase.execute({ username: 'rootuser', password: 'Secret12345' }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.ok(!error.message.includes('duplicate key value'), 'raw pg text must not leak');
      assert.equal(error.message, 'username already exists: ROOTUSER');
      return true;
    },
  );
});

test('bootstrap maps a unique-violation race on email to ConflictError with a clean message', async () => {
  const repository = createFakeRepository({
    createThrows: uniqueViolation(
      'users_email_unique',
      'duplicate key value violates unique constraint "users_email_unique"',
    ),
  });
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () => useCase.execute({ username: 'rootuser', password: 'Secret12345', email: 'root@example.com' }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, 'email already exists: root@example.com');
      return true;
    },
  );
});

test('bootstrap lets non-unique database errors propagate unchanged', async () => {
  const dbError = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
  const repository = createFakeRepository({ createThrows: dbError });
  const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () => useCase.execute({ username: 'rootuser', password: 'Secret12345' }),
    (error) => {
      assert.equal(error, dbError, 'non-23505 errors are not swallowed');
      assert.ok(!(error instanceof ConflictError));
      return true;
    },
  );
});

test('an empty or whitespace-only email behaves like null (no validation, no lookup, persisted NULL)', async () => {
  for (const email of ['', '   ']) {
    const repository = createFakeRepository();
    const useCase = new CreateAdmin({ repository, hasher: new FakeHasher() });

    const created = await useCase.execute({ username: 'rootuser', password: 'Secret12345', email });

    assert.equal(created.email, null, `email ${JSON.stringify(email)} must persist as NULL`);
    assert.equal(repository.calls.findByEmail.length, 0, 'empty email must not trigger an email lookup');
    assert.equal(repository.calls.create[0].email, null);
  }
});