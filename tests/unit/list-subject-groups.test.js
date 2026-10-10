import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListSubjectGroups } from '../../src/modules/subject-groups/application/list-subject-groups.usecase.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

const SUBJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async create(item) { return item; },
    async list(options) { calls.push(options); return []; },
  };
}

test('list defaults pagination, omits absent filter, and returns explicit request envelope', async () => {
  const repository = fakeRepository();
  const result = await new ListSubjectGroups({ repository }).execute();
  assert.deepEqual(result, { items: [], limit: 50, offset: 0 });
  assert.deepEqual(repository.calls, [{ subjectId: undefined, limit: 50, offset: 0 }]);
});

test('list accepts case-insensitive UUID filters and inclusive pagination bounds', async () => {
  const repository = fakeRepository();
  const result = await new ListSubjectGroups({ repository }).execute({
    subject_id: SUBJECT_ID.toUpperCase(), limit: '100', offset: '10000',
  });
  assert.deepEqual(result, { items: [], limit: 100, offset: 10000 });
  assert.deepEqual(repository.calls, [{ subjectId: SUBJECT_ID.toUpperCase(), limit: 100, offset: 10000 }]);
});

test('list rejects empty, padded, repeated, non-string, and malformed subject filters before querying', async () => {
  for (const subject_id of ['', ` ${SUBJECT_ID}`, `${SUBJECT_ID} `, [SUBJECT_ID], {}, 3, 'bad']) {
    const repository = fakeRepository();
    await assert.rejects(
      () => new ListSubjectGroups({ repository }).execute({ subject_id }),
      BadRequestError,
    );
    assert.equal(repository.calls.length, 0);
  }
});

test('list rejects malformed, repeated, non-string and out-of-range pagination before querying', async () => {
  for (const [key, value] of [
    ['limit', ''], ['limit', ['1', '2']], ['limit', '1.5'], ['limit', '-1'],
    ['limit', '0'], ['limit', '101'], ['limit', {}], ['offset', '1.2'],
    ['offset', ['0', '1']], ['offset', '-1'], ['offset', '10001'], ['offset', 1],
  ]) {
    const repository = fakeRepository();
    await assert.rejects(
      () => new ListSubjectGroups({ repository }).execute({ [key]: value }),
      BadRequestError,
    );
    assert.equal(repository.calls.length, 0);
  }
});
