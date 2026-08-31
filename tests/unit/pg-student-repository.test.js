import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgStudentRepository } from '../../src/modules/students/infrastructure/repositories/pg-student.repository.ts';
import { Student } from '../../src/modules/students/domain/student.entity.ts';

function createFakePool(queryHandler) {
  return { query: queryHandler };
}

const CREATED_AT = new Date('2026-08-30T12:00:00Z');

function studentRow(overrides = {}) {
  return {
    id: 'uuid-s1',
    user_id: 'uuid-user',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: '20240123',
    email: 'ana@mail.com',
    celular: '+5491100000000',
    created_by: null,
    created_at: CREATED_AT,
    updated_by: null,
    updated_at: null,
    ...overrides,
  };
}

test('findByCodalumno returns null when no student matches', async () => {
  const repo = new PgStudentRepository(createFakePool(async () => ({ rows: [] })));
  assert.equal(await repo.findByCodalumno('99999999'), null);
});

test('findByCodalumno matches case-insensitively via lower() and maps a row to a Student (STU-003)', async () => {
  const repo = new PgStudentRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /lower\(codalumno\) = lower\(\$\d+\)/);
      assert.deepEqual(params, ['20240123']);
      return { rows: [studentRow()] };
    }),
  );

  const student = await repo.findByCodalumno('20240123');
  assert.ok(student instanceof Student);
  assert.equal(student.id, 'uuid-s1');
  assert.equal(student.userId, 'uuid-user');
  assert.equal(student.nombres, 'Ana');
  assert.equal(student.apellidos, 'Lopez');
  assert.equal(student.codalumno, '20240123');
  assert.equal(student.email, 'ana@mail.com');
  assert.equal(student.celular, '+5491100000000');
  assert.equal(student.createdBy, null);
  assert.equal(student.createdAt, CREATED_AT);
  assert.equal(student.updatedBy, null, 'creation leaves updated_by NULL (AUD-001)');
  assert.equal(student.updatedAt, null, 'creation leaves updated_at NULL (AUD-001)');
});

test('create inserts the student with audit columns and returns the persisted entity', async () => {
  const repo = new PgStudentRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /INSERT INTO students/);
      assert.deepEqual(params, [
        'uuid-user',
        'Ana',
        'Lopez',
        '20240123',
        'ana@mail.com',
        '+5491100000000',
        'actor-1',
        null,
        null,
      ]);
      return { rows: [studentRow({ id: 'uuid-s2', created_by: 'actor-1' })] };
    }),
  );

  const student = await repo.create(
    new Student({
      userId: 'uuid-user',
      nombres: 'Ana',
      apellidos: 'Lopez',
      codalumno: '20240123',
      email: 'ana@mail.com',
      celular: '+5491100000000',
      createdBy: 'actor-1',
    }),
  );
  assert.equal(student.id, 'uuid-s2');
  assert.equal(student.userId, 'uuid-user');
  assert.equal(student.codalumno, '20240123');
  assert.equal(student.createdBy, 'actor-1');
  assert.equal(student.createdAt, CREATED_AT);
});

test('create accepts an optional client and routes the INSERT through it, not the pool', async () => {
  let poolCalls = 0;
  const repo = new PgStudentRepository(
    createFakePool(async () => {
      poolCalls += 1;
      throw new Error('must not touch the pool when a client is given');
    }),
  );
  const clientCalls = [];
  const client = {
    async query(text, params) {
      clientCalls.push([text, params]);
      return { rows: [studentRow({ id: 'uuid-s3' })] };
    },
  };

  const student = await repo.create(
    new Student({
      userId: 'uuid-user',
      nombres: 'Luis',
      apellidos: 'Perez',
      codalumno: 'ABC123',
    }),
    client,
  );

  assert.equal(poolCalls, 0);
  assert.equal(clientCalls.length, 1);
  assert.match(clientCalls[0][0], /INSERT INTO students/);
  assert.deepEqual(clientCalls[0][1], [
    'uuid-user',
    'Luis',
    'Perez',
    'ABC123',
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.equal(student.id, 'uuid-s3');
});