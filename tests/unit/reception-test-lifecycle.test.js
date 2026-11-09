import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupReceptionTest, observeStarted, releaseAndSettleReceptionOperations } from '../helpers/reception-test-lifecycle.js';

test('observes rejected started operations and retains their rejection for settlement', async () => {
  const failure = new Error('operation failed');
  const observed = observeStarted(Promise.reject(failure));
  assert.deepEqual(await observed, { status: 'rejected', reason: failure });
});

test('releases every interleaving barrier and settles every started rejection', async () => {
  const released = [];
  const failure = new Error('started operation failed');
  const outcomes = await releaseAndSettleReceptionOperations([
    () => released.push('scope'),
    () => released.push('blocker'),
  ], [observeStarted(Promise.reject(failure)), observeStarted(Promise.resolve('done'))]);
  assert.deepEqual(released, ['scope', 'blocker']);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['rejected', 'fulfilled']);
});

test('attempts every cleanup and retains primary plus cleanup failures', async () => {
  const primary = new Error('test failed');
  const firstCleanup = new Error('first cleanup failed');
  const secondCleanup = new Error('second cleanup failed');
  const attempted = [];

  await assert.rejects(cleanupReceptionTest([
    async () => { attempted.push('server'); throw firstCleanup; },
    async () => { attempted.push('database'); throw secondCleanup; },
    async () => { attempted.push('pool'); },
  ], primary), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, firstCleanup, secondCleanup]);
    return true;
  });
  assert.deepEqual(attempted, ['server', 'database', 'pool']);
});
