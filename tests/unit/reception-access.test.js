import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { createReceptionRouter } from '../../src/modules/reception/infrastructure/routes/reception.routes.ts';

test('Reception career options are the live active grants for the authenticated account', async () => {
  const grants = ['kinesiology'];
  const calls = [];
  const repository = {
    async listGrants(userId, activeOnly) { calls.push([userId, activeOnly]); return grants.map((careerCode) => ({ careerCode })); },
  };
  const app = express();
  app.use((req, _res, next) => { req.auth = { userId: '40000000-0000-4000-8000-000000000001', role: 'reception', permissions: ['reception:careers:read'] }; next(); });
  app.use('/reception', createReceptionRouter({ repository, surface: 'self', hasher: { async hash(value) { return value; } } }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/reception/careers`;
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { careers: ['kinesiology'] });
    grants.splice(0, 1, 'odontology');
    const second = await fetch(url);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { careers: ['odontology'] });
    assert.deepEqual(calls, [['40000000-0000-4000-8000-000000000001', true], ['40000000-0000-4000-8000-000000000001', true]]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
