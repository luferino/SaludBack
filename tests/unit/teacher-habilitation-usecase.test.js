import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestError, UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';
import { ActivateTeacherHabilitation } from '../../src/modules/teacher-habilitations/application/activate-teacher-habilitation.usecase.ts';
import { TeacherHabilitation } from '../../src/modules/teacher-habilitations/domain/teacher-habilitation.entity.ts';

const IDS = {
  teacher: '30000000-0000-4000-8000-000000000001',
  subject: '10000000-0000-4000-8000-000000000001',
  group: '20000000-0000-4000-8000-000000000001',
  actor: '40000000-0000-4000-8000-000000000001',
};

function setup() {
  const calls = [];
  const repository = {
    async activate(input) {
      calls.push(input);
      return new TeacherHabilitation({
        id: '50000000-0000-4000-8000-000000000001',
        ...input,
        activatedAt: '2026-04-05T06:07:08.000Z',
      });
    },
  };
  return { useCase: new ActivateTeacherHabilitation({ repository }), calls };
}

test('activation validates a verified UUID actor and all target UUIDs before repository mutation', async () => {
  const { useCase, calls } = setup();
  const result = await useCase.execute({
    teacher_id: IDS.teacher,
    subject_id: IDS.subject,
    academic_group_id: IDS.group,
    activatedBy: IDS.actor,
  });
  assert.deepEqual(calls, [{
    teacherId: IDS.teacher,
    subjectId: IDS.subject,
    academicGroupId: IDS.group,
    activatedBy: IDS.actor,
  }]);
  assert.deepEqual(result.toJSON(), {
    id: '50000000-0000-4000-8000-000000000001',
    teacher_id: IDS.teacher,
    subject_id: IDS.subject,
    academic_group_id: IDS.group,
    activated_by: IDS.actor,
    activated_at: '2026-04-05T06:07:08.000Z',
    revoked_by: null,
    revoked_at: null,
  });
});

test('missing, malformed, or non-UUID actor is unauthorized and cannot reach the repository', async () => {
  const { useCase, calls } = setup();
  for (const activatedBy of [null, undefined, '', 'not-a-uuid']) {
    await assert.rejects(
      useCase.execute({ teacher_id: IDS.teacher, subject_id: IDS.subject, academic_group_id: IDS.group, activatedBy }),
      UnauthorizedError,
    );
  }
  assert.equal(calls.length, 0);
});

test('invalid teacher or context UUID is bad request and cannot reach the repository', async () => {
  const { useCase, calls } = setup();
  for (const invalid of [
    { teacher_id: 'bad', subject_id: IDS.subject, academic_group_id: IDS.group },
    { teacher_id: IDS.teacher, subject_id: null, academic_group_id: IDS.group },
    { teacher_id: IDS.teacher, subject_id: IDS.subject, academic_group_id: 42 },
  ]) {
    await assert.rejects(useCase.execute({ ...invalid, activatedBy: IDS.actor }), BadRequestError);
  }
  assert.equal(calls.length, 0);
});
