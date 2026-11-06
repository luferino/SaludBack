import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createCareerRouter } from '../../src/modules/careers/infrastructure/routes/career.routes.ts';
import { Career } from '../../src/modules/careers/domain/career.entity.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

async function withServer(repository, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const permission = req.headers['x-permission'];
    if (permission) req.auth = { userId: 'verified-actor', permissions: [permission], role: 'teacher' };
    next();
  });
  app.use('/careers', createCareerRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async list() {
      calls.push('list');
      return [
        new Career({ id: 'career-1', code: 'kinesiology', name: 'Kinesiología' }),
        new Career({ id: 'career-2', code: 'odontology', name: 'Odontología' }),
      ];
    },
  };
}

test('GET requires careers:read and serializes exactly the items envelope', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const response = await fetch(`${base}/careers`, { headers: { 'x-permission': 'careers:read' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [
        { id: 'career-1', code: 'kinesiology', name: 'Kinesiología' },
        { id: 'career-2', code: 'odontology', name: 'Odontología' },
      ],
    });
  });
  assert.deepEqual(repository.calls, ['list']);
});

test('GET is denied to subjects:read holders and to unauthenticated callers before the repository runs', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const wrongPermission = await fetch(`${base}/careers`, { headers: { 'x-permission': 'subjects:read' } });
    assert.equal(wrongPermission.status, 403);
    assert.deepEqual(await wrongPermission.json(), { error: { code: 'FORBIDDEN', message: "Permission 'careers:read' required" } });
    const unauthenticated = await fetch(`${base}/careers`);
    assert.equal(unauthenticated.status, 401);
  });
  assert.equal(repository.calls.length, 0);
});

test('careers exposes no write routes', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const response = await fetch(`${base}/careers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-permission': 'careers:read' },
      body: JSON.stringify({ code: 'dentistry', name: 'Odontología' }),
    });
    assert.equal(response.status, 404);
  });
  assert.equal(repository.calls.length, 0);
});
