import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RegisterUser } from '../../src/modules/auth/application/register-user.usecase.ts';
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
      return new User({ ...user, id: 'uuid-new', createdAt: new Date('2026-08-05T12:00:00Z') });
    },
  };
}

test('successful registration creates an estudiante with a hashed password and email', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({
    username: 'jperez',
    password: 'secret12345',
    email: 'jperez@example.com',
  });

  assert.equal(created.username, 'JPEREZ');
  assert.equal(created.role, 'estudiante');
  assert.equal(created.email, 'jperez@example.com');
  assert.equal(created.passwordHash, 'hashed:secret12345');
  assert.equal(repository.calls.findByUsername[0], 'JPEREZ');
  assert.equal(repository.calls.findByEmail[0], 'jperez@example.com');
  assert.equal(repository.calls.create.length, 1);
});

test('duplicate username throws ConflictError and does not create', async () => {
  const repository = createFakeRepository({
    existingByUsername: new User({ username: 'JPEREZ', passwordHash: 'x', role: 'estudiante' }),
  });
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () =>
      useCase.execute({
        username: 'jperez',
        password: 'secret12345',
        email: 'jperez@example.com',
      }),
    ConflictError,
  );
  assert.equal(repository.calls.create.length, 0);
});

test('duplicate email throws ConflictError and does not create', async () => {
  const repository = createFakeRepository({
    existingByEmail: new User({
      username: 'otro',
      passwordHash: 'x',
      role: 'estudiante',
      email: 'dup@example.com',
    }),
  });
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () =>
      useCase.execute({
        username: 'nuevo',
        password: 'secret12345',
        email: 'dup@example.com',
      }),
    ConflictError,
  );
  assert.equal(repository.calls.create.length, 0);
});

test('missing or empty username throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  await assert.rejects(
    () => useCase.execute({ password: 'secret12345', email: 'a@example.com' }),
    BadRequestError,
  );
  await assert.rejects(
    () => useCase.execute({ username: '  ', password: 'secret12345', email: 'a@example.com' }),
    BadRequestError,
  );
});

test('missing or empty password throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', email: 'a@example.com' }),
    BadRequestError,
  );
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: '', email: 'a@example.com' }),
    BadRequestError,
  );
});

test('missing, empty or malformed email throws BadRequestError', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: 'secret12345' }),
    BadRequestError,
  );
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: 'secret12345', email: '  ' }),
    BadRequestError,
  );
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: 'secret12345', email: 'not-an-email' }),
    BadRequestError,
  );
  assert.equal(repository.calls.create.length, 0);
});

test('whitespace-only or missing email is rejected with email is required', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });
  for (const input of [
    { username: 'jperez', password: 'secret12345' },
    { username: 'jperez', password: 'secret12345', email: '' },
    { username: 'jperez', password: 'secret12345', email: '   ' },
  ]) {
    await assert.rejects(
      () => useCase.execute(input),
      (error) => {
        assert.ok(error instanceof BadRequestError);
        assert.equal(error.message, 'email is required');
        return true;
      },
    );
  }
  assert.equal(repository.calls.create.length, 0);
});

test('email with surrounding whitespace is trimmed before lookup and storage', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({
    username: 'jperez',
    password: 'secret12345',
    email: '  jperez@example.com  ',
  });

  assert.equal(created.email, 'jperez@example.com');
  assert.equal(repository.calls.findByEmail[0], 'jperez@example.com');
  assert.equal(repository.calls.create[0].email, 'jperez@example.com');
});

test('duplicate check treats a padded email and the stored email as the same (409)', async () => {
  const repository = createFakeRepository({
    existingByEmail: new User({
      username: 'otro',
      passwordHash: 'x',
      role: 'estudiante',
      email: 'dup@example.com',
    }),
  });
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () =>
      useCase.execute({
        username: 'nuevo',
        password: 'secret12345',
        email: '  dup@example.com  ',
      }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, 'email already exists: dup@example.com');
      return true;
    },
  );
  assert.equal(repository.calls.create.length, 0);
});

test('password too short throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: 'short1', email: 'a@example.com' }),
    (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.message, 'password must be at least 10 characters');
      return true;
    },
  );
});

test('password without digit throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: 'lettersonly', email: 'a@example.com' }),
    (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.message, 'password must contain at least one letter and one number');
      return true;
    },
  );
});

test('password without letter throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  await assert.rejects(
    () => useCase.execute({ username: 'jperez', password: '1234567890', email: 'a@example.com' }),
    (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.message, 'password must contain at least one letter and one number');
      return true;
    },
  );
});

test('username with invalid characters (dot, dash, underscore, space) throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  for (const invalid of ['j.perez', 'j-perez', 'j_perez', 'j perez']) {
    await assert.rejects(
      () => useCase.execute({ username: invalid, password: 'secret12345', email: 'a@example.com' }),
      (error) => {
        assert.ok(error instanceof BadRequestError);
        assert.equal(error.message, 'username may only contain letters and numbers');
        return true;
      },
    );
  }
});

test('username is normalized to uppercase', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({
    username: 'jperez',
    password: 'secret12345',
    email: 'jperez@example.com',
  });

  assert.equal(created.username, 'JPEREZ');
  assert.equal(repository.calls.findByUsername[0], 'JPEREZ');
});

test('email with invalid format throws BadRequestError', async () => {
  const useCase = new RegisterUser({ repository: createFakeRepository(), hasher: new FakeHasher() });
  for (const invalid of ['not-an-email', '@example.com', 'user@', 'user@.com', 'user@example']) {
    await assert.rejects(
      () => useCase.execute({ username: 'jperez', password: 'secret12345', email: invalid }),
      (error) => {
        assert.ok(error instanceof BadRequestError);
        assert.equal(error.message, 'email must be a valid address');
        return true;
      },
    );
  }
});

test('registration passes createdBy through to the persisted entity (AUD-003)', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({
    username: 'actor1',
    password: 'secret12345',
    email: 'actor1@example.com',
    createdBy: 'actor-1',
  });

  assert.equal(created.createdBy, 'actor-1');
  assert.equal(repository.calls.create[0].createdBy, 'actor-1');
});

/** Mimics a pg unique_violation error (SQLSTATE 23505) with its constraint name. */
function uniqueViolation(constraint, message) {
  return Object.assign(new Error(message), { code: '23505', constraint });
}

test('registration maps a unique-violation race on username to ConflictError with a clean message', async () => {
  const repository = createFakeRepository({
    createThrows: uniqueViolation(
      'users_username_key',
      'duplicate key value violates unique constraint "users_username_key"',
    ),
  });
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () =>
      useCase.execute({
        username: 'jperez',
        password: 'secret12345',
        email: 'jperez@example.com',
      }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.ok(!error.message.includes('duplicate key value'), 'raw pg text must not leak');
      assert.equal(error.message, 'username already exists: JPEREZ');
      return true;
    },
  );
});

test('registration maps a unique-violation race on email to ConflictError with a clean message', async () => {
  const repository = createFakeRepository({
    createThrows: uniqueViolation(
      'users_email_unique',
      'duplicate key value violates unique constraint "users_email_unique"',
    ),
  });
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () =>
      useCase.execute({
        username: 'jperez',
        password: 'secret12345',
        email: 'jperez@example.com',
      }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, 'email already exists: jperez@example.com');
      return true;
    },
  );
});

test('registration lets non-unique database errors propagate unchanged', async () => {
  const dbError = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
  const repository = createFakeRepository({ createThrows: dbError });
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  await assert.rejects(
    () =>
      useCase.execute({
        username: 'jperez',
        password: 'secret12345',
        email: 'jperez@example.com',
      }),
    (error) => {
      assert.equal(error, dbError, 'non-23505 errors are not swallowed');
      assert.ok(!(error instanceof ConflictError));
      return true;
    },
  );
});

test('registration without a createdBy defaults the audit actor to null', async () => {
  const repository = createFakeRepository();
  const useCase = new RegisterUser({ repository, hasher: new FakeHasher() });

  const created = await useCase.execute({
    username: 'actor2',
    password: 'secret12345',
    email: 'actor2@example.com',
  });

  assert.equal(created.createdBy, null);
  assert.equal(repository.calls.create[0].createdBy, null);
});
