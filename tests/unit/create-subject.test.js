import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateSubject } from '../../src/modules/subjects/application/create-subject.usecase.ts';
import { Subject } from '../../src/modules/subjects/domain/subject.entity.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

function fakeRepository() {
  const calls = { create: [], list: [] };
  return {
    calls,
    async create(subject) {
      calls.create.push(subject);
      return new Subject({ ...subject, id: 'subject-1', createdAt: new Date('2026-01-02T03:04:05Z') });
    },
    async list(options) {
      calls.list.push(options);
      return [];
    },
  };
}

test('create trims a valid name, passes nullable actor, and persists duplicate names without lookup', async () => {
  const repository = fakeRepository();
  const useCase = new CreateSubject({ repository });
  const created = await useCase.execute({ name: '  Mathematics  ', createdBy: 'actor-1' });
  const duplicate = await useCase.execute({ name: 'Mathematics', createdBy: null });

  assert.ok(created instanceof Subject);
  assert.equal(created.name, 'Mathematics');
  assert.equal(created.createdBy, 'actor-1');
  assert.equal(duplicate.name, created.name);
  assert.equal(repository.calls.create.length, 2);
  assert.equal(repository.calls.create[1].createdBy, null);
});

test('create rejects absent, non-string, and blank names before repository access', async () => {
  for (const name of [undefined, null, 1, {}, '', '  \t  ']) {
    const repository = fakeRepository();
    const useCase = new CreateSubject({ repository });
    await assert.rejects(() => useCase.execute({ name }), BadRequestError);
    assert.equal(repository.calls.create.length, 0);
  }
});
