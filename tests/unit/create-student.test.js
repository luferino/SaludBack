import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateStudent } from '../../src/modules/students/application/create-student.usecase.ts';
import { Student } from '../../src/modules/students/domain/student.entity.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';
import { BadRequestError, ConflictError } from '../../src/modules/shared/domain/errors.ts';

const CREATED_AT = new Date('2026-08-30T12:00:00Z');
const CLIENT = { query: async () => ({ rows: [] }) };

function createFakeStudentRepository(overrides = {}) {
  const calls = { findByCodalumno: [], create: [] };
  return {
    calls,
    async findByCodalumno(codalumno) {
      calls.findByCodalumno.push(codalumno);
      return overrides.existing ?? null;
    },
    async create(student, client) {
      calls.create.push({ ...student, client });
      return new Student({ ...student, id: 'uuid-student', createdAt: CREATED_AT });
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
  const studentRepository = overrides.studentRepository ?? createFakeStudentRepository();
  const userRepository = overrides.userRepository ?? createFakeUserRepository();
  const hasher = overrides.hasher ?? createFakeHasher();
  const unitOfWork = overrides.unitOfWork ?? createFakeUnitOfWork();
  const useCase = new CreateStudent({ studentRepository, userRepository, hasher, unitOfWork });
  return { studentRepository, userRepository, hasher, unitOfWork, useCase };
}

const VALID_INPUT = {
  username: 'jperez',
  password: 'secret123',
  nombres: 'Ana',
  apellidos: 'Lopez',
  codalumno: '20240123',
  email: 'jperez@mail.com',
  celular: '+5491100000000',
};

test('successful alta en uno creates the user and the student in one tx and passes createdBy (STU-001)', async () => {
  const { studentRepository, userRepository, hasher, unitOfWork, useCase } = buildUseCase();

  const student = await useCase.execute({ ...VALID_INPUT, createdBy: 'actor-1' });

  assert.ok(student instanceof Student);
  assert.equal(student.codalumno, '20240123');
  assert.equal(student.createdBy, 'actor-1');

  // Duplicate check ran first with the trimmed codalumno.
  assert.deepEqual(studentRepository.calls.findByCodalumno, ['20240123']);
  // User resolution: username miss, then email lookup.
  assert.deepEqual(userRepository.calls.findByUsername, ['jperez']);
  assert.deepEqual(userRepository.calls.findByEmail, ['jperez@mail.com']);

  // Password hashed once and the account created with role estudiante.
  assert.deepEqual(hasher.calls.hash, ['secret123']);
  assert.equal(userRepository.calls.create.length, 1);
  assert.equal(userRepository.calls.create[0].username, 'jperez');
  assert.equal(userRepository.calls.create[0].passwordHash, 'hashed-value');
  assert.equal(userRepository.calls.create[0].role, 'estudiante');
  assert.equal(userRepository.calls.create[0].email, 'jperez@mail.com');

  // Both writes ran inside the unit of work and share its client.
  assert.equal(unitOfWork.calls.withTransaction.length, 1);
  assert.equal(userRepository.calls.create[0].client, CLIENT);
  assert.equal(studentRepository.calls.create[0].client, CLIENT);
  // The student row links to the created user (STU-001).
  assert.equal(studentRepository.calls.create[0].userId, 'uuid-new-user');
  assert.equal(studentRepository.calls.create[0].createdBy, 'actor-1');
});

test('anonymous create defaults createdBy to null and an email-less account has email null (UAC-002)', async () => {
  const { studentRepository, userRepository, useCase } = buildUseCase();

  const student = await useCase.execute({
    username: 'jperez',
    password: 'secret123',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: '20240123',
  });

  assert.equal(student.createdBy, null);
  assert.equal(student.email, null);
  assert.equal(userRepository.calls.findByEmail.length, 0, 'no email payload -> no email lookup');
  assert.equal(userRepository.calls.create[0].email, null);
  assert.equal(studentRepository.calls.create[0].email, null);
  assert.equal(studentRepository.calls.create[0].celular, null);
});

test('blank email or celular normalize to null instead of 400 (UAC-002)', async () => {
  const { studentRepository, useCase } = buildUseCase();

  const student = await useCase.execute({ ...VALID_INPUT, email: '   ', celular: '' });

  assert.equal(student.email, null);
  assert.equal(studentRepository.calls.create[0].email, null);
  assert.equal(studentRepository.calls.create[0].celular, null);
});

test('username and codalumno are trimmed before lookup and persistence (STU-003)', async () => {
  const { studentRepository, userRepository, useCase } = buildUseCase();

  await useCase.execute({ ...VALID_INPUT, username: '  jperez  ', codalumno: ' 20240123 ' });

  assert.deepEqual(userRepository.calls.findByUsername, ['jperez']);
  assert.deepEqual(studentRepository.calls.findByCodalumno, ['20240123']);
  assert.equal(userRepository.calls.create[0].username, 'jperez');
  assert.equal(studentRepository.calls.create[0].codalumno, '20240123');
});

test('existing username links the student without hashing or creating an account (STU-002)', async () => {
  const existing = new User({
    id: 'uuid-existing-user',
    username: 'jperez',
    passwordHash: 'keep-me',
    role: 'teacher',
    email: null,
  });
  const { studentRepository, userRepository, hasher, useCase } = buildUseCase({
    userRepository: createFakeUserRepository({ byUsername: existing }),
  });

  const student = await useCase.execute({ ...VALID_INPUT, password: 'ignored-when-linking' });

  assert.equal(student.userId, 'uuid-existing-user');
  assert.equal(hasher.calls.hash.length, 0, 'existing credentials are NOT re-hashed');
  assert.equal(userRepository.calls.create.length, 0, 'no duplicate account (STU-002)');
  assert.equal(userRepository.calls.findByEmail.length, 0, 'username hit short-circuits the email lookup');
  assert.equal(studentRepository.calls.create.length, 1);
  assert.equal(studentRepository.calls.create[0].userId, 'uuid-existing-user');
});

test('existing email links the student when the username is free (STU-002)', async () => {
  const existing = new User({
    id: 'uuid-email-user',
    username: 'otro-usuario',
    passwordHash: 'keep-me',
    role: 'teacher',
    email: 'jperez@mail.com',
  });
  const { studentRepository, userRepository, hasher, useCase } = buildUseCase({
    userRepository: createFakeUserRepository({ byEmail: existing }),
  });

  const student = await useCase.execute(VALID_INPUT);

  assert.equal(student.userId, 'uuid-email-user');
  assert.equal(hasher.calls.hash.length, 0);
  assert.equal(userRepository.calls.create.length, 0);
  assert.equal(studentRepository.calls.create[0].userId, 'uuid-email-user');
});

test('no matching user creates the account with role estudiante and the hashed password (STU-002)', async () => {
  const { userRepository, studentRepository, useCase } = buildUseCase();

  const student = await useCase.execute(VALID_INPUT);

  assert.equal(student.userId, 'uuid-new-user');
  assert.equal(userRepository.calls.create.length, 1);
  assert.equal(userRepository.calls.create[0].role, 'estudiante');
  assert.equal(studentRepository.calls.create[0].userId, 'uuid-new-user');
});

test('duplicate codalumno throws ConflictError before any user work and persists nothing (STU-003)', async () => {
  const existing = new Student({
    id: 'uuid-existing-student',
    userId: 'uuid-existing-user',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: '20240123',
  });
  const { studentRepository, userRepository, hasher, useCase } = buildUseCase({
    studentRepository: createFakeStudentRepository({ existing }),
  });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    { name: 'ConflictError', message: 'codalumno already exists: 20240123' },
  );
  assert.deepEqual(studentRepository.calls.findByCodalumno, ['20240123']);
  assert.equal(userRepository.calls.findByUsername.length, 0);
  assert.equal(hasher.calls.hash.length, 0);
  assert.equal(userRepository.calls.create.length, 0);
  assert.equal(studentRepository.calls.create.length, 0);
});

test('invalid codalumno formats throw BadRequestError before any lookup (STU-003)', async () => {
  for (const codalumno of ['12_34A', '2024-00123', 'ABC 123', 'A.B', 'abc$']) {
    const { studentRepository, userRepository, useCase } = buildUseCase();

    await assert.rejects(
      () => useCase.execute({ ...VALID_INPUT, codalumno }),
      BadRequestError,
    );
    assert.equal(studentRepository.calls.findByCodalumno.length, 0, `${codalumno} must fail before the dup check`);
    assert.equal(userRepository.calls.create.length, 0);
    assert.equal(studentRepository.calls.create.length, 0);
  }
});

test('missing, null, or blank required fields throw BadRequestError and never persist', async () => {
  for (const field of ['username', 'password', 'nombres', 'apellidos', 'codalumno']) {
    for (const badValue of [undefined, null, '', '   ']) {
      const { userRepository, studentRepository, useCase } = buildUseCase();

      await assert.rejects(
        () => useCase.execute({ ...VALID_INPUT, [field]: badValue }),
        BadRequestError,
      );
      assert.equal(userRepository.calls.create.length, 0, `${field} = ${JSON.stringify(badValue)} must not create a user`);
      assert.equal(studentRepository.calls.create.length, 0, `${field} = ${JSON.stringify(badValue)} must not create a student`);
    }
  }
});

test('malformed email throws BadRequestError and persists nothing (UAC-002)', async () => {
  for (const email of ['not-an-email', 'missing-at.com', 'two@@at.com']) {
    const { userRepository, studentRepository, useCase } = buildUseCase();

    await assert.rejects(() => useCase.execute({ ...VALID_INPUT, email }), BadRequestError);
    assert.equal(userRepository.calls.create.length, 0);
    assert.equal(studentRepository.calls.create.length, 0);
  }
});

test('Student.toJSON returns exactly the 8 STU-004 contract keys and hides internals (AUD-002)', () => {
  const student = new Student({
    id: 'uuid-s',
    userId: 'uuid-user',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: '20240123',
    email: null,
    celular: null,
    createdBy: null,
    createdAt: CREATED_AT,
    updatedBy: 'actor-9',
    updatedAt: new Date('2026-08-31T12:00:00Z'),
  });

  const json = student.toJSON();
  assert.deepEqual(Object.keys(json).sort(), [
    'apellidos',
    'celular',
    'codalumno',
    'created_at',
    'created_by',
    'email',
    'id',
    'nombres',
  ]);
  assert.equal(json.created_by, null);
  // Internal FKs, credentials, and update audit never serialize.
  assert.equal('user_id' in json, false);
  assert.equal('userId' in json, false);
  assert.equal('username' in json, false);
  assert.equal('password' in json, false);
  assert.equal('updated_by' in json, false);
  assert.equal('updated_at' in json, false);
});

test('Student.create builds a new student with audit defaults', () => {
  const student = Student.create({
    userId: 'uuid-user',
    nombres: 'Luis',
    apellidos: 'Perez',
    codalumno: 'ABC123',
    createdBy: 'actor-1',
  });

  assert.ok(student instanceof Student);
  assert.equal(student.userId, 'uuid-user');
  assert.equal(student.codalumno, 'ABC123');
  assert.equal(student.email, null);
  assert.equal(student.celular, null);
  assert.equal(student.createdBy, 'actor-1');
});