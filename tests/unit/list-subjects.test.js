import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListSubjects } from '../../src/modules/subjects/application/list-subjects.usecase.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async create(subject) { return subject; },
    async list(options) { calls.push(options); return []; },
  };
}

test('list applies documented defaults and returns the request envelope', async () => {
  const repository = fakeRepository();
  const result = await new ListSubjects({ repository }).execute();
  assert.deepEqual(result, { items: [], limit: 50, offset: 0 });
  assert.deepEqual(repository.calls, [{ careerId: undefined, limit: 50, offset: 0 }]);
});

test('list forwards a canonical career filter and keeps pagination unchanged', async () => {
  const repository = fakeRepository();
  const careerId = '11111111-1111-4111-8111-111111111111';
  const result = await new ListSubjects({ repository }).execute({ career_id: careerId, limit: '5', offset: '2' });
  assert.deepEqual(result, { items: [], limit: 5, offset: 2 });
  assert.deepEqual(repository.calls, [{ careerId, limit: 5, offset: 2 }]);
});

test('list rejects malformed or repeated career filters with the exact 400 message before querying', async () => {
  const careerId = '11111111-1111-4111-8111-111111111111';
  for (const career_id of ['', ` ${careerId}`, `${careerId} `, [careerId], {}, 3, 'bad']) {
    const repository = fakeRepository();
    await assert.rejects(
      () => new ListSubjects({ repository }).execute({ career_id }),
      (error) => error instanceof BadRequestError && error.message === 'career_id must be a UUID',
    );
    assert.equal(repository.calls.length, 0);
  }
});

test('list accepts inclusive bounds and parses integer query strings', async () => {
  const repository = fakeRepository();
  const result = await new ListSubjects({ repository }).execute({ limit: '100', offset: '10000' });
  assert.deepEqual(result, { items: [], limit: 100, offset: 10000 });
  assert.deepEqual(repository.calls, [{ careerId: undefined, limit: 100, offset: 10000 }]);
  await new ListSubjects({ repository }).execute({ limit: '1', offset: '0' });
});

test('list rejects malformed, repeated, fractional, negative and out-of-range values before querying', async () => {
  for (const [key, value] of [
    ['limit', 'abc'], ['limit', ['1', '2']], ['limit', '1.5'], ['limit', '-1'],
    ['limit', '0'], ['limit', '101'], ['offset', '1.2'], ['offset', ['0', '1']],
    ['offset', '-1'], ['offset', '10001'], ['offset', 'Infinity'],
  ]) {
    const repository = fakeRepository();
    await assert.rejects(() => new ListSubjects({ repository }).execute({ [key]: value }), BadRequestError);
    assert.equal(repository.calls.length, 0, `${key}=${String(value)} must not reach persistence`);
  }
});
