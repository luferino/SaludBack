import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgTeacherRepository } from '../../src/modules/teachers/infrastructure/repositories/pg-teacher.repository.ts';
import { Teacher } from '../../src/modules/teachers/domain/teacher.entity.ts';

function createFakePool(queryHandler) {
  return { query: queryHandler };
}

const CREATED_AT = new Date('2026-08-30T12:00:00Z');

function teacherRow(overrides = {}) {
  return {
    id: 'uuid-t1',
    user_id: 'uuid-user',
    nombres: 'Maria',
    apellidos: 'Ruiz',
    email: 'maria@mail.com',
    celular: '+5491100000000',
    created_by: null,
    created_at: CREATED_AT,
    updated_by: null,
    updated_at: null,
    ...overrides,
  };
}

test('create inserts the teacher with audit columns and returns the persisted entity (TEA-001)', async () => {
  const repo = new PgTeacherRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /INSERT INTO teachers/);
      assert.deepEqual(params, [
        'uuid-user',
        'Maria',
        'Ruiz',
        'maria@mail.com',
        '+5491100000000',
        'actor-1',
        null,
        null,
      ]);
      return { rows: [teacherRow({ id: 'uuid-t2', created_by: 'actor-1' })] };
    }),
  );

  const teacher = await repo.create(
    new Teacher({
      userId: 'uuid-user',
      nombres: 'Maria',
      apellidos: 'Ruiz',
      email: 'maria@mail.com',
      celular: '+5491100000000',
      createdBy: 'actor-1',
    }),
  );
  assert.ok(teacher instanceof Teacher);
  assert.equal(teacher.id, 'uuid-t2');
  assert.equal(teacher.userId, 'uuid-user');
  assert.equal(teacher.nombres, 'Maria');
  assert.equal(teacher.apellidos, 'Ruiz');
  assert.equal(teacher.email, 'maria@mail.com');
  assert.equal(teacher.celular, '+5491100000000');
  assert.equal(teacher.createdBy, 'actor-1');
  assert.equal(teacher.createdAt, CREATED_AT);
  assert.equal(teacher.updatedBy, null, 'creation leaves updated_by NULL (AUD-001)');
  assert.equal(teacher.updatedAt, null, 'creation leaves updated_at NULL (AUD-001)');
});

test('create accepts an optional client and routes the INSERT through it, not the pool', async () => {
  let poolCalls = 0;
  const repo = new PgTeacherRepository(
    createFakePool(async () => {
      poolCalls += 1;
      throw new Error('must not touch the pool when a client is given');
    }),
  );
  const clientCalls = [];
  const client = {
    async query(text, params) {
      clientCalls.push([text, params]);
      return { rows: [teacherRow({ id: 'uuid-t3' })] };
    },
  };

  const teacher = await repo.create(
    new Teacher({
      userId: 'uuid-user',
      nombres: 'Luis',
      apellidos: 'Perez',
    }),
    client,
  );

  assert.equal(poolCalls, 0);
  assert.equal(clientCalls.length, 1);
  assert.match(clientCalls[0][0], /INSERT INTO teachers/);
  assert.deepEqual(clientCalls[0][1], [
    'uuid-user',
    'Luis',
    'Perez',
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.equal(teacher.id, 'uuid-t3');
});