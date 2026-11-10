import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createReceptionRouter } from '../../src/modules/reception/infrastructure/routes/reception.routes.ts';
import { PgReceptionAccessRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-access.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

async function withSearch(run, auth = { role: 'admin', permissions: ['reception:accounts:write'] }) {
  const calls = [];
  const items = [{ id: '40000000-0000-4000-8000-000000000002', username: 'ALE', email: 'ale@example.invalid', active_careers: [] }];
  const repository = { async searchAccounts(input) { calls.push(input); return input.q === 'absent' ? [] : items; } };
  const app = express();
  app.use((req, _res, next) => { req.auth = auth; next(); });
  app.use('/auth', createReceptionRouter({ repository, hasher: { async hash() { throw new Error('read must not hash'); } } }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(async (query = '') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/accounts${query}`);
      const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
      return { status: response.status, cache: response.headers.get('cache-control'), body };
    }, calls, items);
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('account search lists without filters, trims literal q, combines career and paginates exact minimal DTO', async () => {
  await withSearch(async (get, calls, items) => {
    assert.deepEqual(await get(), { status: 200, cache: 'no-store', body: { items, limit: 50, offset: 0 } });
    assert.deepEqual(calls.pop(), { q: undefined, career: undefined, limit: 50, offset: 0 });
    assert.deepEqual((await get('?q=%20a%25_%20&career=kinesiology&limit=1&offset=10000')).body, { items, limit: 1, offset: 10000 });
    assert.deepEqual(calls.pop(), { q: 'a%_', career: 'kinesiology', limit: 1, offset: 10000 });
    assert.equal((await get('?q=%20%20&career=odontology&limit=100&offset=0')).status, 200);
    assert.deepEqual(calls.pop(), { q: undefined, career: 'odontology', limit: 100, offset: 0 });
    assert.deepEqual((await get('?q=absent')).body, { items: [], limit: 50, offset: 0 });
    assert.equal((await get(`?q=${'a'.repeat(100)}`)).status, 200);
  });
});

test('question marks inside q remain literal while later query parameters are still validated', async () => {
  await withSearch(async (get, calls) => {
    assert.equal((await get('?q=ale?x')).status, 200);
    assert.deepEqual(calls.pop(), { q: 'ale?x', career: undefined, limit: 50, offset: 0 });

    for (const [query, message] of [
      ['?q=ale?x&unknown=1', 'unknown query parameter: unknown'],
      ['?q=ale?x&q=b', 'query parameter must not be repeated: q'],
    ]) {
      const response = await get(query);
      assert.equal(response.status, 400, query);
      assert.deepEqual(response.body, { error: { code: 'BAD_REQUEST', message } }, query);
    }
    assert.deepEqual(calls, []);
  });
});

test('account search rejects invalid, unknown and repeated query input before repository access', async () => {
  await withSearch(async (get, calls) => {
    const cases = [
      ['?limit=0', 'limit must be an integer between 1 and 100'],
      ['?limit=101', 'limit must be an integer between 1 and 100'],
      ['?offset=-1', 'offset must be an integer between 0 and 10000'],
      ['?offset=10001', 'offset must be an integer between 0 and 10000'],
      ['?limit=1.5', 'limit must be an integer between 1 and 100'],
      ['?limit=1e2', 'limit must be an integer between 1 and 100'],
      ['?limit=', 'limit must be an integer between 1 and 100'],
      ['?offset=x', 'offset must be an integer between 0 and 10000'],
      ['?career=unknown', 'career must be kinesiology or odontology'],
      ['?career=', 'career must be kinesiology or odontology'],
      [`?q=${'a'.repeat(101)}`, 'q must be at most 100 characters'],
      ['?role=admin', 'unknown query parameter: role'],
      ['?q=a&q=b', 'query parameter must not be repeated: q'],
      ['?career=kinesiology&career=odontology', 'query parameter must not be repeated: career'],
      ['?limit=1&limit=2', 'query parameter must not be repeated: limit'],
      ['?offset=0&offset=1', 'query parameter must not be repeated: offset'],
      ['?q[x]=a', 'unknown query parameter: q[x]'],
    ];
    for (const [query, message] of cases) {
      const response = await get(query);
      assert.equal(response.status, 400, query);
      assert.deepEqual(response.body, { error: { code: 'BAD_REQUEST', message } }, query);
    }
    assert.deepEqual(calls, []);
  });
});

test('account search requires authentication, admin role AND dedicated permission before reading', async () => {
  const cases = [
    [undefined, 401, 'UNAUTHORIZED', 'Authentication required'],
    [{ role: 'admin', permissions: [] }, 403, 'FORBIDDEN', "Permission 'reception:accounts:write' required"],
    ...['reception', 'teacher', 'estudiante'].map(role => [{ role, permissions: ['reception:accounts:write'] }, 403, 'FORBIDDEN', 'Admin role required']),
  ];
  for (const [auth, status, code, message] of cases) {
    await withSearch(async (get, calls) => {
      const response = await get('?q=secret');
      assert.equal(response.status, status);
      assert.deepEqual(response.body, { error: { code, message } });
      assert.deepEqual(calls, []);
    }, auth === undefined ? null : auth);
  }
});

test('PostgreSQL search uses a single parameterized read and returns only the public projection', async () => {
  const calls = [];
  const rows = [{ id: 'id', username: 'ALE', email: 'ale@example.invalid', active_careers: ['kinesiology'] }];
  const repository = new PgReceptionAccessRepository({ async query(sql, values) { calls.push({ sql, values }); return { rows }; } });
  assert.deepEqual(await repository.searchAccounts({ q: "a%_\\'", career: 'kinesiology', limit: 20, offset: 0 }), rows);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ["a%_\\'", 'kinesiology', 20, 0]);
  assert.match(calls[0].sql, /u\.role = 'reception'/);
  assert.match(calls[0].sql, /ORDER BY u\.username, u\.id/);
  assert.doesNotMatch(calls[0].sql, /password|INSERT|UPDATE|DELETE/);
  assert.equal(calls[0].sql.includes("a%_\\'"), false);
});
