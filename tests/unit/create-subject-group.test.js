import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateSubjectGroup } from '../../src/modules/subject-groups/application/create-subject-group.usecase.ts';
import { SubjectGroup } from '../../src/modules/subject-groups/domain/subject-group.entity.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

const SUBJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async create(subjectGroup) {
      calls.push(subjectGroup);
      return new SubjectGroup({ ...subjectGroup, createdAt: new Date('2026-02-03T04:05:06Z') });
    },
    async list() { return []; },
  };
}

test('create accepts case-insensitive canonical UUIDs and carries only the separately supplied nullable actor', async () => {
  const repository = fakeRepository();
  const result = await new CreateSubjectGroup({ repository }).execute({
    subject_id: SUBJECT_ID.toUpperCase(),
    academic_group_id: GROUP_ID,
    createdBy: null,
    created_by: 'untrusted-client-attribution',
  });

  assert.ok(result instanceof SubjectGroup);
  assert.equal(result.subjectId, SUBJECT_ID.toUpperCase());
  assert.equal(result.academicGroupId, GROUP_ID);
  assert.equal(result.createdBy, null);
  assert.equal(repository.calls.length, 1);
});

test('create defaults actor to null and passes a verified actor separately', async () => {
  const repository = fakeRepository();
  const useCase = new CreateSubjectGroup({ repository });
  await useCase.execute({ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID });
  await useCase.execute({ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, createdBy: 'verified-actor' });
  assert.equal(repository.calls[0].createdBy, null);
  assert.equal(repository.calls[1].createdBy, 'verified-actor');
});

test('create rejects malformed, non-string, or padded UUIDs before persistence', async () => {
  for (const [field, value] of [
    ['subject_id', undefined], ['subject_id', null], ['subject_id', 1], ['subject_id', {}],
    ['subject_id', ` ${SUBJECT_ID}`], ['subject_id', `${SUBJECT_ID} `], ['subject_id', 'not-a-uuid'],
    ['subject_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaZ'],
    ['academic_group_id', undefined], ['academic_group_id', []], ['academic_group_id', 4],
    ['academic_group_id', `\t${GROUP_ID}`], ['academic_group_id', 'bbbbbbbb-bbbb-4bbb-8bbb'],
  ]) {
    const repository = fakeRepository();
    await assert.rejects(
      () => new CreateSubjectGroup({ repository }).execute({
        subject_id: SUBJECT_ID,
        academic_group_id: GROUP_ID,
        [field]: value,
      }),
      BadRequestError,
      `${field}=${String(value)} should fail validation`,
    );
    assert.equal(repository.calls.length, 0);
  }
});
