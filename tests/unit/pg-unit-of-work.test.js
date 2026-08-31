import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgUnitOfWork } from '../../src/modules/shared/infrastructure/pg-unit-of-work.ts';

function createFakeClient() {
  const calls = { queries: [], releases: 0 };
  return {
    calls,
    async query(text) {
      calls.queries.push(text);
      return { rows: [] };
    },
    async release() {
      calls.releases += 1;
    },
  };
}

function createFakePool(client) {
  return { connect: async () => client };
}

test('withTransaction runs BEGIN -> work -> COMMIT, returns the result, and releases the client', async () => {
  const client = createFakeClient();
  const uow = new PgUnitOfWork(createFakePool(client));

  const result = await uow.withTransaction(async (workClient) => {
    assert.equal(workClient, client);
    await workClient.query('SELECT 1');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(client.calls.queries, ['BEGIN', 'SELECT 1', 'COMMIT']);
  assert.equal(client.calls.releases, 1);
});

test('withTransaction rolls back and rethrows when the work fails, without COMMIT', async () => {
  const client = createFakeClient();
  const uow = new PgUnitOfWork(createFakePool(client));
  const boom = new Error('boom');

  await assert.rejects(
    () =>
      uow.withTransaction(async () => {
        throw boom;
      }),
    (error) => error === boom,
  );

  assert.deepEqual(client.calls.queries, ['BEGIN', 'ROLLBACK']);
  assert.equal(client.calls.releases, 1);
});

test('work queries run inside the transaction and are rolled back on failure', async () => {
  const client = createFakeClient();
  const uow = new PgUnitOfWork(createFakePool(client));

  await assert.rejects(
    () =>
      uow.withTransaction(async (workClient) => {
        await workClient.query('INSERT INTO students (user_id) VALUES ($1)');
        throw new Error('constraint violation');
      }),
    /constraint violation/,
  );

  assert.deepEqual(client.calls.queries, ['BEGIN', 'INSERT INTO students (user_id) VALUES ($1)', 'ROLLBACK']);
  assert.equal(client.calls.releases, 1);
});