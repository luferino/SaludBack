import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateSubject } from '../../src/modules/subjects/application/create-subject.usecase.ts';
import { Subject } from '../../src/modules/subjects/domain/subject.entity.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

const CAREER_ID = '11111111-1111-4111-8111-111111111111';

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

test('create trims a valid name, carries the career and nullable actor, and persists duplicate names without lookup', async () => {
  const repository = fakeRepository();
  const useCase = new CreateSubject({ repository });
  const created = await useCase.execute({ name: '  Mathematics  ', career_id: CAREER_ID, createdBy: 'actor-1' });
  const duplicate = await useCase.execute({ name: 'Mathematics', career_id: CAREER_ID, createdBy: null });

  assert.ok(created instanceof Subject);
  assert.equal(created.name, 'Mathematics');
  assert.equal(created.careerId, CAREER_ID);
  assert.equal(created.createdBy, 'actor-1');
  assert.equal(duplicate.name, created.name);
  assert.equal(repository.calls.create.length, 2);
  assert.equal(repository.calls.create[0].careerId, CAREER_ID);
  assert.equal(repository.calls.create[1].createdBy, null);
});

test('create keeps the existing name rule ahead of the career rule', async () => {
  const repository = fakeRepository();
  await assert.rejects(
    () => new CreateSubject({ repository }).execute({ name: '  ', career_id: 'not-a-uuid' }),
    (error) => error instanceof BadRequestError && error.message === 'name must be a nonblank string',
  );
  assert.equal(repository.calls.create.length, 0);
});

test('create rejects absent, non-string, and blank names before repository access', async () => {
  for (const name of [undefined, null, 1, {}, '', '  \t  ']) {
    const repository = fakeRepository();
    const useCase = new CreateSubject({ repository });
    await assert.rejects(() => useCase.execute({ name, career_id: CAREER_ID }), BadRequestError);
    assert.equal(repository.calls.create.length, 0);
  }
});

test('create requires a canonical career_id before repository access with the exact 400 message', async () => {
  for (const career_id of [undefined, null, 1, {}, [CAREER_ID], '', 'not-a-uuid', ` ${CAREER_ID}`, `${CAREER_ID} `]) {
    const repository = fakeRepository();
    await assert.rejects(
      () => new CreateSubject({ repository }).execute({ name: 'Biology', career_id }),
      (error) => error instanceof BadRequestError && error.statusCode === 400 && error.message === 'career_id must be a UUID',
      `career_id=${String(career_id)} must be rejected`,
    );
    assert.equal(repository.calls.create.length, 0);
  }
});
