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
  assert.deepEqual(repository.calls, [{ limit: 50, offset: 0 }]);
});

test('list accepts inclusive bounds and parses integer query strings', async () => {
  const repository = fakeRepository();
  const result = await new ListSubjects({ repository }).execute({ limit: '100', offset: '10000' });
  assert.deepEqual(result, { items: [], limit: 100, offset: 10000 });
  assert.deepEqual(repository.calls, [{ limit: 100, offset: 10000 }]);
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
