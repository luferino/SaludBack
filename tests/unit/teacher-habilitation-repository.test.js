import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';
import { PgTeacherHabilitationRepository } from '../../src/modules/teacher-habilitations/infrastructure/repositories/pg-teacher-habilitation.repository.ts';

const INPUT = {
  teacherId: '30000000-0000-4000-8000-000000000001',
  subjectId: '10000000-0000-4000-8000-000000000001',
  academicGroupId: '20000000-0000-4000-8000-000000000001',
  activatedBy: '40000000-0000-4000-8000-000000000001',
};
const ROW = {
  id: '50000000-0000-4000-8000-000000000001',
  teacher_id: INPUT.teacherId,
  subject_id: INPUT.subjectId,
  academic_group_id: INPUT.academicGroupId,
  activated_by: INPUT.activatedBy,
  activated_at: new Date('2026-04-05T06:07:08Z'),
  revoked_by: null,
  revoked_at: null,
};

function repositoryWith(query) {
  const calls = [];
  const pool = { async query(text, params) { calls.push({ text, params }); return query(text, params); } };
  return { repository: new PgTeacherHabilitationRepository(pool), calls };
}

test('activation uses parameterized insert, database clock, and maps the returned period', async () => {
  const { repository, calls } = repositoryWith(async () => ({ rows: [ROW] }));
  const period = await repository.activate(INPUT);
  assert.deepEqual(calls, [{
    text: calls[0].text,
    params: [INPUT.teacherId, INPUT.subjectId, INPUT.academicGroupId, INPUT.activatedBy],
  }]);
  assert.match(calls[0].text, /INSERT INTO teacher_academic_habilitations/);
  assert.match(calls[0].text, /clock_timestamp\(\)/);
  assert.doesNotMatch(calls[0].text, /activated_at\s*=\s*\$\d/i);
  assert.deepEqual(period.toJSON(), {
    id: ROW.id,
    teacher_id: INPUT.teacherId,
    subject_id: INPUT.subjectId,
    academic_group_id: INPUT.academicGroupId,
    activated_by: INPUT.activatedBy,
    activated_at: '2026-04-05T06:07:08.000Z',
    revoked_by: null,
    revoked_at: null,
  });
});

test('only the named active-context index and teacher/context foreign keys map to domain errors', async () => {
  for (const [databaseError, ExpectedError] of [
    [{ code: '23505', constraint: 'teacher_habilitations_one_active_context' }, ConflictError],
    [{ code: '23503', constraint: 'teacher_academic_habilitations_teacher_id_fkey' }, NotFoundError],
    [{ code: '23503', constraint: 'teacher_habilitations_context_fk' }, NotFoundError],
  ]) {
    const { repository } = repositoryWith(async () => { throw Object.assign(new Error('database detail'), databaseError); });
    await assert.rejects(repository.activate(INPUT), ExpectedError);
  }
});

test('unexpected constraints and activation-actor foreign-key failures propagate unchanged', async () => {
  const errors = [
    Object.assign(new Error('unexpected actor reference'), { code: '23503', constraint: 'teacher_academic_habilitations_activated_by_fkey' }),
    Object.assign(new Error('unexpected unique constraint'), { code: '23505', constraint: 'some_other_unique_key' }),
    new Error('connection failed'),
  ];
  for (const error of errors) {
    const { repository } = repositoryWith(async () => { throw error; });
    await assert.rejects(repository.activate(INPUT), (actual) => actual === error);
  }
});
