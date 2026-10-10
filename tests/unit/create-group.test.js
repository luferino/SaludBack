import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateGroup } from '../../src/modules/groups/application/create-group.usecase.ts';
import { Group } from '../../src/modules/groups/domain/group.entity.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async create(group) {
      calls.push(group);
      return group;
    },
    async list() { return []; },
  };
}

test('create accepts positive PostgreSQL integer boundaries and trims names without changing case', async () => {
  const repository = fakeRepository();
  const useCase = new CreateGroup({ repository });
  const group = await useCase.execute({
    academic_year: 1,
    curriculum_semester: 2147483647,
    name: '  BioChemistry  ',
  });
  const maxGroup = await useCase.execute({
    academic_year: 2147483647,
    curriculum_semester: 1,
    name: 'MATHEMATICS',
  });

  assert.ok(group instanceof Group);
  assert.deepEqual(
    [group.academicYear, group.curriculumSemester, group.name, group.createdBy],
    [1, 2147483647, 'BioChemistry', null],
  );
  assert.deepEqual(
    [maxGroup.academicYear, maxGroup.curriculumSemester, maxGroup.name],
    [2147483647, 1, 'MATHEMATICS'],
  );
  assert.equal(repository.calls.length, 2);
});

test('create preserves a supplied nullable actor and does not accept an attribution alias', async () => {
  const repository = fakeRepository();
  const useCase = new CreateGroup({ repository });
  const attributed = await useCase.execute({
    academic_year: 2026,
    curriculum_semester: 99,
    name: 'History',
    createdBy: 'verified-actor',
  });
  const anonymous = await useCase.execute({
    academic_year: 2026,
    curriculum_semester: 100,
    name: 'history',
    createdBy: null,
    created_by: 'client-spoof',
  });

  assert.equal(attributed.createdBy, 'verified-actor');
  assert.equal(anonymous.createdBy, null);
});

test('create rejects non-positive, fractional, non-number and out-of-range catalog integers before persistence', async () => {
  for (const [field, value] of [
    ['academic_year', undefined], ['academic_year', null], ['academic_year', '2026'],
    ['academic_year', 0], ['academic_year', -1], ['academic_year', 1.5], ['academic_year', 2147483648],
    ['curriculum_semester', undefined], ['curriculum_semester', null], ['curriculum_semester', '2'],
    ['curriculum_semester', 0], ['curriculum_semester', -1], ['curriculum_semester', 2.25],
    ['curriculum_semester', 2147483648],
  ]) {
    const repository = fakeRepository();
    const useCase = new CreateGroup({ repository });
    await assert.rejects(() => useCase.execute({
      academic_year: 2026,
      curriculum_semester: 2,
      name: 'Biology',
      [field]: value,
    }), BadRequestError, `${field}=${String(value)}`);
    assert.equal(repository.calls.length, 0);
  }
});

test('create rejects absent, non-string, and blank names before persistence', async () => {
  for (const name of [undefined, null, 1, {}, '', '  \t  ']) {
    const repository = fakeRepository();
    const useCase = new CreateGroup({ repository });
    await assert.rejects(() => useCase.execute({
      academic_year: 2026,
      curriculum_semester: 1,
      name,
    }), BadRequestError);
    assert.equal(repository.calls.length, 0);
  }
});
