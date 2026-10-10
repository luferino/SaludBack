import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListGroups } from '../../src/modules/groups/application/list-groups.usecase.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async create(group) { return group; },
    async list(options) { calls.push(options); return []; },
  };
}

test('list applies defaults and returns the pagination envelope', async () => {
  const repository = fakeRepository();
  const result = await new ListGroups({ repository }).execute();
  assert.deepEqual(result, { items: [], limit: 50, offset: 0 });
  assert.deepEqual(repository.calls, [{ limit: 50, offset: 0 }]);
});

test('list accepts inclusive bounds and strictly parses decimal query strings', async () => {
  const repository = fakeRepository();
  const result = await new ListGroups({ repository }).execute({ limit: '100', offset: '10000' });
  assert.deepEqual(result, { items: [], limit: 100, offset: 10000 });
  assert.deepEqual(repository.calls, [{ limit: 100, offset: 10000 }]);
  await new ListGroups({ repository }).execute({ limit: '1', offset: '0' });
  assert.deepEqual(repository.calls[1], { limit: 1, offset: 0 });
});

test('list rejects arrays, malformed and out-of-range query values before persistence', async () => {
  for (const [key, value] of [
    ['limit', null], ['limit', 1], ['limit', ''], ['limit', ' 1'], ['limit', '1 '], ['limit', '+1'],
    ['limit', '1.5'], ['limit', '-1'], ['limit', '0'], ['limit', '101'], ['limit', ['1', '2']],
    ['offset', null], ['offset', 0], ['offset', ''], ['offset', '1.2'], ['offset', '-1'],
    ['offset', '10001'], ['offset', 'Infinity'], ['offset', ['0', '1']],
  ]) {
    const repository = fakeRepository();
    await assert.rejects(() => new ListGroups({ repository }).execute({ [key]: value }), BadRequestError);
    assert.equal(repository.calls.length, 0, `${key}=${String(value)} must not reach persistence`);
  }
});
