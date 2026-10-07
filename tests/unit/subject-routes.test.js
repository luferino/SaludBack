import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createSubjectRouter } from '../../src/modules/subjects/infrastructure/routes/subject.routes.ts';
import { Subject } from '../../src/modules/subjects/domain/subject.entity.ts';

async function withServer(repository, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const permission = req.headers['x-permission'];
    if (permission) req.auth = { userId: 'verified-actor', permissions: [permission], role: 'teacher' };
    next();
  });
  app.use('/subjects', createSubjectRouter({ repository }));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ message: error.message }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeRepository() {
  const calls = { create: [], list: [] };
  return {
    calls,
    async create(subject) {
      calls.create.push(subject);
      return new Subject({ ...subject, id: 'subject-1', createdAt: new Date('2026-02-03T04:05:06Z') });
    },
    async list(options) { calls.list.push(options); return [new Subject({ id: 'subject-1', name: 'Biology', createdAt: '2026-02-03T04:05:06Z' })]; },
  };
}

test('POST requires subjects:write independently of role and ignores client actor spoofing', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const denied = await fetch(`${base}/subjects`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'subjects:read' }, body: JSON.stringify({ name: 'Math', createdBy: 'spoofed' }) });
    assert.equal(denied.status, 403);
    const response = await fetch(`${base}/subjects`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'subjects:write' }, body: JSON.stringify({ name: '  Math  ', createdBy: 'spoofed', created_by: 'spoofed' }) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'subject-1', name: 'Math', created_by: 'verified-actor', created_at: '2026-02-03T04:05:06.000Z' });
  });
  assert.equal(repository.calls.create.length, 1);
  assert.equal(repository.calls.create[0].createdBy, 'verified-actor');
});

test('GET requires subjects:read and serializes only the envelope and explicit subject fields', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const denied = await fetch(`${base}/subjects`, { headers: { 'x-permission': 'subjects:write' } });
    assert.equal(denied.status, 403);
    const response = await fetch(`${base}/subjects?limit=5&offset=2`, { headers: { 'x-permission': 'subjects:read' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ id: 'subject-1', name: 'Biology', created_by: null, created_at: '2026-02-03T04:05:06.000Z' }], limit: 5, offset: 2 });
  });
  assert.deepEqual(repository.calls.list, [{ limit: 5, offset: 2 }]);
});

test('missing auth is unauthorized and invalid listing query never reads repository', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const unauthorized = await fetch(`${base}/subjects`);
    assert.equal(unauthorized.status, 401);
    const malformed = await fetch(`${base}/subjects?limit=1&limit=2`, { headers: { 'x-permission': 'subjects:read' } });
    assert.equal(malformed.status, 400);
  });
  assert.equal(repository.calls.list.length, 0);
});
