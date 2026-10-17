import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgGroupRepository } from '../../src/modules/groups/infrastructure/repositories/pg-group.repository.ts';
import { Group } from '../../src/modules/groups/domain/group.entity.ts';
import { ConflictError } from '../../src/modules/shared/domain/errors.ts';

const CREATED_AT = new Date('2026-02-03T04:05:06Z');
function row(overrides = {}) {
  return {
    id: 'group-1',
    academic_year: 2026,
    curriculum_semester: 2,
    name: 'Biology',
    created_by: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

test('create uses a parameterized insert and maps returned database columns', async () => {
  let call;
  const repository = new PgGroupRepository({
    async query(text, params) {
      call = { text, params };
      return { rows: [row({ created_by: 'actor-1' })] };
    },
  });
  const result = await repository.create(new Group({
    academicYear: 2026,
    curriculumSemester: 2,
    name: 'Biology',
    createdBy: 'actor-1',
  }));

  assert.match(call.text, /INSERT INTO academic_groups \(academic_year, curriculum_semester, name, created_by\)/);
  assert.match(call.text, /VALUES \(\$1, \$2, \$3, \$4\)\s+RETURNING id, academic_year, curriculum_semester, name, created_by, created_at/);
  assert.deepEqual(call.params, [2026, 2, 'Biology', 'actor-1']);
  assert.deepEqual(
    [result.id, result.academicYear, result.curriculumSemester, result.name, result.createdBy, result.createdAt],
    ['group-1', 2026, 2, 'Biology', 'actor-1', CREATED_AT],
  );
});

test('create translates only the named academic group uniqueness violation to conflict', async () => {
  const duplicate = Object.assign(new Error('duplicate'), {
    code: '23505',
    constraint: 'academic_groups_year_semester_name_unique',
  });
  const repository = new PgGroupRepository({ async query() { throw duplicate; } });
  await assert.rejects(
    () => repository.create(new Group({ academicYear: 2026, curriculumSemester: 2, name: 'Biology' })),
    (error) => error instanceof ConflictError && error.statusCode === 409,
  );
});

test('create propagates unrelated constraint violations and non-database errors unchanged', async () => {
  const failures = [
    Object.assign(new Error('actor foreign key'), { code: '23503', constraint: 'academic_groups_created_by_fkey' }),
    Object.assign(new Error('different unique constraint'), { code: '23505', constraint: 'other_unique_key' }),
    new Error('database unavailable'),
    { code: '23505', constraint: 'academic_groups_year_semester_name_unique' },
  ];
  for (const failure of failures) {
    const repository = new PgGroupRepository({ async query() { throw failure; } });
    await assert.rejects(
      () => repository.create(new Group({ academicYear: 2026, curriculumSemester: 2, name: 'Biology' })),
      (error) => error === failure,
    );
  }
});

test('list uses stable academic ordering and parameterized pagination', async () => {
  let call;
  const repository = new PgGroupRepository({
    async query(text, params) { call = { text, params }; return { rows: [row()] }; },
  });
  const results = await repository.list({ limit: 20, offset: 40 });
  assert.match(
    call.text,
    /ORDER BY academic_year ASC, curriculum_semester ASC, name ASC, id ASC\s+LIMIT \$1 OFFSET \$2/,
  );
  assert.deepEqual(call.params, [20, 40]);
  assert.equal(results[0].name, 'Biology');
});

test('group serialization exposes only explicit snake-case fields and ISO timestamps', () => {
  const serialized = new Group({
    id: 'group-1',
    academicYear: 2026,
    curriculumSemester: 2,
    name: 'Biology',
    createdBy: null,
    createdAt: CREATED_AT,
  }).toJSON();
  assert.deepEqual(serialized, {
    id: 'group-1',
    academic_year: 2026,
    curriculum_semester: 2,
    name: 'Biology',
    created_by: null,
    created_at: '2026-02-03T04:05:06.000Z',
  });
  assert.deepEqual(Object.keys(serialized), [
    'id', 'academic_year', 'curriculum_semester', 'name', 'created_by', 'created_at',
  ]);
});
