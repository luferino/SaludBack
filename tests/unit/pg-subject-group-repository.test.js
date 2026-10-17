import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgSubjectGroupRepository } from '../../src/modules/subject-groups/infrastructure/repositories/pg-subject-group.repository.ts';
import { SubjectGroup } from '../../src/modules/subject-groups/domain/subject-group.entity.ts';
import { ConflictError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';

const SUBJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CREATED_AT = new Date('2026-02-03T04:05:06Z');

function row(overrides = {}) {
  return {
    subject_id: SUBJECT_ID,
    academic_group_id: GROUP_ID,
    created_by: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

test('create uses parameterized insert and maps returned pair columns', async () => {
  let call;
  const repository = new PgSubjectGroupRepository({
    async query(text, params) { call = { text, params }; return { rows: [row({ created_by: 'actor-1' })] }; },
  });
  const result = await repository.create(new SubjectGroup({
    subjectId: SUBJECT_ID, academicGroupId: GROUP_ID, createdBy: 'actor-1',
  }));

  assert.match(call.text, /INSERT INTO subject_academic_groups \(subject_id, academic_group_id, created_by\)/);
  assert.match(call.text, /VALUES \(\$1, \$2, \$3\)\s+RETURNING subject_id, academic_group_id, created_by, created_at/);
  assert.deepEqual(call.params, [SUBJECT_ID, GROUP_ID, 'actor-1']);
  assert.deepEqual(
    [result.subjectId, result.academicGroupId, result.createdBy, result.createdAt],
    [SUBJECT_ID, GROUP_ID, 'actor-1', CREATED_AT],
  );
});

test('create translates only the association primary key violation to conflict', async () => {
  const duplicate = Object.assign(new Error('duplicate'), {
    code: '23505', constraint: 'subject_academic_groups_pkey',
  });
  const repository = new PgSubjectGroupRepository({ async query() { throw duplicate; } });
  await assert.rejects(
    () => repository.create(new SubjectGroup({ subjectId: SUBJECT_ID, academicGroupId: GROUP_ID })),
    (error) => error instanceof ConflictError && error.statusCode === 409 && error.code === 'CONFLICT',
  );
});

test('create translates only subject and academic-group foreign keys to reusable not-found', async () => {
  for (const constraint of [
    'subject_academic_groups_subject_id_fkey',
    'subject_academic_groups_academic_group_id_fkey',
  ]) {
    const missingReference = Object.assign(new Error('foreign key'), { code: '23503', constraint });
    const repository = new PgSubjectGroupRepository({ async query() { throw missingReference; } });
    await assert.rejects(
      () => repository.create(new SubjectGroup({ subjectId: SUBJECT_ID, academicGroupId: GROUP_ID })),
      (error) => error instanceof NotFoundError && error.statusCode === 404 && error.code === 'NOT_FOUND',
    );
  }
});

test('create propagates actor FK and unknown database failures by identity', async () => {
  const failures = [
    Object.assign(new Error('actor foreign key'), {
      code: '23503', constraint: 'subject_academic_groups_created_by_fkey',
    }),
    Object.assign(new Error('other foreign key'), { code: '23503', constraint: 'another_table_fkey' }),
    Object.assign(new Error('other unique constraint'), { code: '23505', constraint: 'other_unique_key' }),
    Object.assign(new Error('database unavailable'), { code: '08006' }),
    { code: '23505', constraint: 'subject_academic_groups_pkey' },
  ];
  for (const failure of failures) {
    const repository = new PgSubjectGroupRepository({ async query() { throw failure; } });
    await assert.rejects(
      () => repository.create(new SubjectGroup({ subjectId: SUBJECT_ID, academicGroupId: GROUP_ID })),
      (error) => error === failure,
    );
  }
});

test('list queries only association rows with parameterized stable ordering when unfiltered', async () => {
  let call;
  const repository = new PgSubjectGroupRepository({
    async query(text, params) { call = { text, params }; return { rows: [row()] }; },
  });
  const results = await repository.list({ limit: 20, offset: 40 });
  assert.match(call.text, /FROM subject_academic_groups\s+ORDER BY subject_id ASC, academic_group_id ASC\s+LIMIT \$1 OFFSET \$2/);
  assert.doesNotMatch(call.text, /JOIN|COUNT|WHERE/);
  assert.deepEqual(call.params, [20, 40]);
  assert.equal(results[0].subjectId, SUBJECT_ID);
});

test('list parameterizes optional subject filter and returns empty rows unchanged', async () => {
  let call;
  const repository = new PgSubjectGroupRepository({
    async query(text, params) { call = { text, params }; return { rows: [] }; },
  });
  const results = await repository.list({ subjectId: SUBJECT_ID, limit: 7, offset: 9 });
  assert.match(call.text, /FROM subject_academic_groups\s+WHERE subject_id = \$1\s+ORDER BY subject_id ASC, academic_group_id ASC\s+LIMIT \$2 OFFSET \$3/);
  assert.doesNotMatch(call.text, /JOIN|COUNT/);
  assert.deepEqual(call.params, [SUBJECT_ID, 7, 9]);
  assert.deepEqual(results, []);
});

test('pair serialization exposes only pair keys, actor, and ISO timestamp', () => {
  const serialized = new SubjectGroup({
    subjectId: SUBJECT_ID,
    academicGroupId: GROUP_ID,
    createdBy: null,
    createdAt: CREATED_AT,
  }).toJSON();
  assert.deepEqual(serialized, {
    subject_id: SUBJECT_ID,
    academic_group_id: GROUP_ID,
    created_by: null,
    created_at: '2026-02-03T04:05:06.000Z',
  });
  assert.deepEqual(Object.keys(serialized), ['subject_id', 'academic_group_id', 'created_by', 'created_at']);
});
