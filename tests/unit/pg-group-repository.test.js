import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgGroupRepository } from '../../src/modules/groups/infrastructure/repositories/pg-group.repository.ts';
import { Group } from '../../src/modules/groups/domain/group.entity.ts';
import { ConflictError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';

const CREATED_AT = new Date('2026-02-03T04:05:06Z');
const CAREER_ID = '11111111-1111-4111-8111-111111111111';
function row(overrides = {}) {
  return {
    id: 'group-1',
    academic_year: 2026,
    curriculum_semester: 2,
    name: 'Biology',
    career_id: CAREER_ID,
    created_by: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

test('create uses a parameterized insert with the career and maps returned database columns', async () => {
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
    careerId: CAREER_ID,
    createdBy: 'actor-1',
  }));

  assert.match(call.text, /INSERT INTO academic_groups \(academic_year, curriculum_semester, name, career_id, created_by\)/);
  assert.match(call.text, /VALUES \(\$1, \$2, \$3, \$4, \$5\)\s+RETURNING id, academic_year, curriculum_semester, name, career_id, created_by, created_at/);
  assert.deepEqual(call.params, [2026, 2, 'Biology', CAREER_ID, 'actor-1']);
  assert.deepEqual(
    [result.id, result.academicYear, result.curriculumSemester, result.name, result.careerId, result.createdBy, result.createdAt],
    ['group-1', 2026, 2, 'Biology', CAREER_ID, 'actor-1', CREATED_AT],
  );
});

test('create translates only the per-career uniqueness violation to the new conflict message', async () => {
  const duplicate = Object.assign(new Error('duplicate'), {
    code: '23505',
    constraint: 'academic_groups_career_year_semester_name_unique',
  });
  const repository = new PgGroupRepository({ async query() { throw duplicate; } });
  await assert.rejects(
    () => repository.create(new Group({ academicYear: 2026, curriculumSemester: 2, name: 'Biology', careerId: CAREER_ID })),
    (error) => error instanceof ConflictError && error.statusCode === 409 && error.code === 'CONFLICT'
      && error.message === 'group already exists for career, academic year, semester, and name',
  );
});

test('create translates only the career foreign key to reusable not-found', async () => {
  const missingCareer = Object.assign(new Error('foreign key'), { code: '23503', constraint: 'academic_groups_career_id_fkey' });
  const repository = new PgGroupRepository({ async query() { throw missingCareer; } });
  await assert.rejects(
    () => repository.create(new Group({ academicYear: 2026, curriculumSemester: 2, name: 'Biology', careerId: CAREER_ID })),
    (error) => error instanceof NotFoundError && error.statusCode === 404 && error.message === 'career was not found',
  );
});

test('create propagates unrelated constraint violations, including the retired global uniqueness name, unchanged', async () => {
  const failures = [
    Object.assign(new Error('actor foreign key'), { code: '23503', constraint: 'academic_groups_created_by_fkey' }),
    Object.assign(new Error('different unique constraint'), { code: '23505', constraint: 'other_unique_key' }),
    Object.assign(new Error('retired global uniqueness'), { code: '23505', constraint: 'academic_groups_year_semester_name_unique' }),
    new Error('database unavailable'),
    { code: '23505', constraint: 'academic_groups_career_year_semester_name_unique' },
  ];
  for (const failure of failures) {
    const repository = new PgGroupRepository({ async query() { throw failure; } });
    await assert.rejects(
      () => repository.create(new Group({ academicYear: 2026, curriculumSemester: 2, name: 'Biology', careerId: CAREER_ID })),
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
    /SELECT id, academic_year, curriculum_semester, name, career_id, created_by, created_at\s+FROM academic_groups\s+ORDER BY academic_year ASC, curriculum_semester ASC, name ASC, id ASC\s+LIMIT \$1 OFFSET \$2/,
  );
  assert.doesNotMatch(call.text, /WHERE/);
  assert.deepEqual(call.params, [20, 40]);
  assert.equal(results[0].name, 'Biology');
  assert.equal(results[0].careerId, CAREER_ID);
});

test('list parameterizes the optional career filter before pagination', async () => {
  let call;
  const repository = new PgGroupRepository({
    async query(text, params) { call = { text, params }; return { rows: [] }; },
  });
  const results = await repository.list({ careerId: CAREER_ID, limit: 7, offset: 9 });
  assert.match(call.text, /FROM academic_groups\s+WHERE career_id = \$1\s+ORDER BY academic_year ASC, curriculum_semester ASC, name ASC, id ASC\s+LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(call.params, [CAREER_ID, 7, 9]);
  assert.deepEqual(results, []);
});

test('group serialization exposes only explicit snake-case fields including the career and ISO timestamps', () => {
  const serialized = new Group({
    id: 'group-1',
    academicYear: 2026,
    curriculumSemester: 2,
    name: 'Biology',
    careerId: CAREER_ID,
    createdBy: null,
    createdAt: CREATED_AT,
  }).toJSON();
  assert.deepEqual(serialized, {
    id: 'group-1',
    academic_year: 2026,
    curriculum_semester: 2,
    name: 'Biology',
    career_id: CAREER_ID,
    created_by: null,
    created_at: '2026-02-03T04:05:06.000Z',
  });
  assert.deepEqual(Object.keys(serialized), [
    'id', 'academic_year', 'curriculum_semester', 'name', 'career_id', 'created_by', 'created_at',
  ]);
});
