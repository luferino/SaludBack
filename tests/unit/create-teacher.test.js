import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateTeacher } from '../../src/modules/teachers/application/create-teacher.usecase.ts';
import { Teacher } from '../../src/modules/teachers/domain/teacher.entity.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

const CREATED_AT = new Date('2026-08-30T12:00:00Z');
const CLIENT = { query: async () => ({ rows: [] }) };

function createFakeTeacherRepository(overrides = {}) {
  const calls = { create: [] };
  return {
    calls,
    async create(teacher, client) {
      calls.create.push({ ...teacher, client });
      return new Teacher({ ...teacher, id: overrides.createdId ?? 'uuid-teacher', createdAt: CREATED_AT });
    },
  };
}

function createFakeUserRepository(overrides = {}) {
  const calls = { findByUsername: [], findByEmail: [], create: [] };
  return {
    calls,
    async findByUsername(username) {
      calls.findByUsername.push(username);
      return overrides.byUsername ?? null;
    },
    async findByEmail(email) {
      calls.findByEmail.push(email);
      return overrides.byEmail ?? null;
    },
    async create(user, client) {
      calls.create.push({ ...user, client });
      return new User({ ...user, id: overrides.createdUserId ?? 'uuid-new-user', createdAt: CREATED_AT });
    },
  };
}

function createFakeHasher() {
  const calls = { hash: [], compare: [] };
  return {
    calls,
    async hash(plain) {
      calls.hash.push(plain);
      return 'hashed-value';
    },
    async compare() {
      return false;
    },
  };
}

function createFakeUnitOfWork() {
  const calls = { withTransaction: [] };
  return {
    calls,
    async withTransaction(fn) {
      calls.withTransaction.push('withTransaction');
      return fn(CLIENT);
    },
  };
}

function buildUseCase(overrides = {}) {
  const teacherRepository = overrides.teacherRepository ?? createFakeTeacherRepository();
  const userRepository = overrides.userRepository ?? createFakeUserRepository();
  const hasher = overrides.hasher ?? createFakeHasher();
  const unitOfWork = overrides.unitOfWork ?? createFakeUnitOfWork();
  const useCase = new CreateTeacher({ teacherRepository, userRepository, hasher, unitOfWork });
  return { teacherRepository, userRepository, hasher, unitOfWork, useCase };
}

const VALID_INPUT = {
  username: 'mruiz',
  password: 'secret123',
  nombres: 'Maria',
  apellidos: 'Ruiz',
  email: 'mruiz@mail.com',
  celular: '+5491100000000',
};

test('successful alta en uno creates the user and the teacher row in one tx and passes createdBy (TEA-001)', async () => {
  const { teacherRepository, userRepository, hasher, unitOfWork, useCase } = buildUseCase();

  const teacher = await useCase.execute({ ...VALID_INPUT, createdBy: 'actor-1' });

  assert.ok(teacher instanceof Teacher);
  assert.equal(teacher.nombres, 'Maria');
  assert.equal(teacher.apellidos, 'Ruiz');
  assert.equal(teacher.createdBy, 'actor-1');

  // User resolution: username miss, then email lookup.
  assert.deepEqual(userRepository.calls.findByUsername, ['mruiz']);
  assert.deepEqual(userRepository.calls.findByEmail, ['mruiz@mail.com']);

  // Password hashed once and the account created with role teacher.
  assert.deepEqual(hasher.calls.hash, ['secret123']);
  assert.equal(userRepository.calls.create.length, 1);
  assert.equal(userRepository.calls.create[0].username, 'mruiz');
  assert.equal(userRepository.calls.create[0].passwordHash, 'hashed-value');
  assert.equal(userRepository.calls.create[0].role, 'teacher');
  assert.equal(userRepository.calls.create[0].email, 'mruiz@mail.com');

  // Both writes ran inside the unit of work and share its client.
  assert.equal(unitOfWork.calls.withTransaction.length, 1);
  assert.equal(userRepository.calls.create[0].client, CLIENT);
  assert.equal(teacherRepository.calls.create[0].client, CLIENT);
  // The teacher row links to the created user (TEA-001).
  assert.equal(teacherRepository.calls.create[0].userId, 'uuid-new-user');
  assert.equal(teacherRepository.calls.create[0].createdBy, 'actor-1');
});

test('anonymous create defaults createdBy to null and an email-less account has email null (UAC-002)', async () => {
  const { teacherRepository, userRepository, useCase } = buildUseCase();

  const teacher = await useCase.execute({
    username: 'mruiz',
    password: 'secret123',
    nombres: 'Maria',
    apellidos: 'Ruiz',
  });

  assert.equal(teacher.createdBy, null);
  assert.equal(teacher.email, null);
  assert.equal(userRepository.calls.findByEmail.length, 0, 'no email payload -> no email lookup');
  assert.equal(userRepository.calls.create[0].email, null);
  assert.equal(teacherRepository.calls.create[0].email, null);
  assert.equal(teacherRepository.calls.create[0].celular, null);
});

test('blank email or celular normalize to null instead of 400 (UAC-002)', async () => {
  const { teacherRepository, useCase } = buildUseCase();

  const teacher = await useCase.execute({ ...VALID_INPUT, email: '   ', celular: '' });

  assert.equal(teacher.email, null);
  assert.equal(teacherRepository.calls.create[0].email, null);
  assert.equal(teacherRepository.calls.create[0].celular, null);
});

test('username is trimmed before lookup and persistence', async () => {
  const { teacherRepository, userRepository, useCase } = buildUseCase();

  await useCase.execute({ ...VALID_INPUT, username: '  mruiz  ' });

  assert.deepEqual(userRepository.calls.findByUsername, ['mruiz']);
  assert.equal(userRepository.calls.create[0].username, 'mruiz');
});

test('existing username links the teacher without hashing or creating an account (TEA-002)', async () => {
  const existing = new User({
    id: 'uuid-existing-user',
    username: 'mruiz',
    passwordHash: 'keep-me',
    role: 'estudiante',
    email: null,
  });
  const { teacherRepository, userRepository, hasher, useCase } = buildUseCase({
    userRepository: createFakeUserRepository({ byUsername: existing }),
  });

  const teacher = await useCase.execute({ ...VALID_INPUT, password: 'ignored-when-linking' });

  assert.equal(teacher.userId, 'uuid-existing-user');
  assert.equal(hasher.calls.hash.length, 0, 'existing credentials are NOT re-hashed');
  assert.equal(userRepository.calls.create.length, 0, 'no duplicate account (TEA-002)');
  assert.equal(userRepository.calls.findByEmail.length, 0, 'username hit short-circuits the email lookup');
  assert.equal(teacherRepository.calls.create.length, 1);
  assert.equal(teacherRepository.calls.create[0].userId, 'uuid-existing-user');
});

test('existing email links the teacher when the username is free (TEA-002)', async () => {
  const existing = new User({
    id: 'uuid-email-user',
    username: 'otro-usuario',
    passwordHash: 'keep-me',
    role: 'estudiante',
    email: 'mruiz@mail.com',
  });
  const { teacherRepository, userRepository, hasher, useCase } = buildUseCase({
    userRepository: createFakeUserRepository({ byEmail: existing }),
  });

  const teacher = await useCase.execute(VALID_INPUT);

  assert.equal(teacher.userId, 'uuid-email-user');
  assert.equal(hasher.calls.hash.length, 0);
  assert.equal(userRepository.calls.create.length, 0);
  assert.equal(teacherRepository.calls.create[0].userId, 'uuid-email-user');
});

test('no matching user creates the account with role teacher and the hashed password (TEA-002)', async () => {
  const { userRepository, teacherRepository, useCase } = buildUseCase();

  const teacher = await useCase.execute(VALID_INPUT);

  assert.equal(teacher.userId, 'uuid-new-user');
  assert.equal(userRepository.calls.create.length, 1);
  assert.equal(userRepository.calls.create[0].role, 'teacher');
  assert.equal(teacherRepository.calls.create[0].userId, 'uuid-new-user');
});

test('missing, null, or blank required fields throw BadRequestError and never persist (TEA-001)', async () => {
  for (const field of ['username', 'password', 'nombres', 'apellidos']) {
    for (const badValue of [undefined, null, '', '   ']) {
      const { userRepository, teacherRepository, useCase } = buildUseCase();

      await assert.rejects(
        () => useCase.execute({ ...VALID_INPUT, [field]: badValue }),
        BadRequestError,
      );
      assert.equal(userRepository.calls.create.length, 0, `${field} = ${JSON.stringify(badValue)} must not create a user`);
      assert.equal(teacherRepository.calls.create.length, 0, `${field} = ${JSON.stringify(badValue)} must not create a teacher`);
    }
  }
});

test('malformed email throws BadRequestError and persists nothing', async () => {
  for (const email of ['not-an-email', 'missing-at.com', 'two@@at.com']) {
    const { userRepository, teacherRepository, useCase } = buildUseCase();

    await assert.rejects(() => useCase.execute({ ...VALID_INPUT, email }), BadRequestError);
    assert.equal(userRepository.calls.create.length, 0);
    assert.equal(teacherRepository.calls.create.length, 0);
  }
});

test('Teacher.toJSON returns exactly the 7 TEA-003 contract keys and hides internals (AUD-002)', () => {
  const teacher = new Teacher({
    id: 'uuid-t',
    userId: 'uuid-user',
    nombres: 'Maria',
    apellidos: 'Ruiz',
    email: null,
    celular: null,
    createdBy: null,
    createdAt: CREATED_AT,
    updatedBy: 'actor-9',
    updatedAt: new Date('2026-08-31T12:00:00Z'),
  });

  const json = teacher.toJSON();
  assert.deepEqual(Object.keys(json).sort(), [
    'apellidos',
    'celular',
    'created_at',
    'created_by',
    'email',
    'id',
    'nombres',
  ]);
  assert.equal(json.created_by, null);
  // Internal FKs, credentials, and update audit never serialize (TEA-003 AUD-002).
  assert.equal('user_id' in json, false);
  assert.equal('userId' in json, false);
  assert.equal('username' in json, false);
  assert.equal('password' in json, false);
  assert.equal('updated_by' in json, false);
  assert.equal('updated_at' in json, false);
});

test('Teacher.create builds a new teacher with audit defaults', () => {
  const teacher = Teacher.create({
    userId: 'uuid-user',
    nombres: 'Luis',
    apellidos: 'Perez',
    createdBy: 'actor-1',
  });

  assert.ok(teacher instanceof Teacher);
  assert.equal(teacher.userId, 'uuid-user');
  assert.equal(teacher.nombres, 'Luis');
  assert.equal(teacher.apellidos, 'Perez');
  assert.equal(teacher.email, null);
  assert.equal(teacher.celular, null);
  assert.equal(teacher.createdBy, 'actor-1');
});