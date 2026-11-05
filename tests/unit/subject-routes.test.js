import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createSubjectRouter } from '../../src/modules/subjects/infrastructure/routes/subject.routes.ts';
import { Subject } from '../../src/modules/subjects/domain/subject.entity.ts';

const CAREER_ID = '11111111-1111-4111-8111-111111111111';

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
    async list(options) {
      calls.list.push(options);
      return [new Subject({ id: 'subject-1', name: 'Biology', careerId: CAREER_ID, createdAt: '2026-02-03T04:05:06Z' })];
    },
  };
}

test('POST requires subjects:write independently of role and ignores client actor spoofing', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const denied = await fetch(`${base}/subjects`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'subjects:read' }, body: JSON.stringify({ name: 'Math', career_id: CAREER_ID, createdBy: 'spoofed' }) });
    assert.equal(denied.status, 403);
    const response = await fetch(`${base}/subjects`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'subjects:write' }, body: JSON.stringify({ name: '  Math  ', career_id: CAREER_ID, createdBy: 'spoofed', created_by: 'spoofed' }) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'subject-1', name: 'Math', career_id: CAREER_ID, created_by: 'verified-actor', created_at: '2026-02-03T04:05:06.000Z' });
  });
  assert.equal(repository.calls.create.length, 1);
  assert.equal(repository.calls.create[0].createdBy, 'verified-actor');
  assert.equal(repository.calls.create[0].careerId, CAREER_ID);
});

test('POST without a canonical career_id is a 400 with the exact message and never reaches the repository', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    for (const body of [{ name: 'Math' }, { name: 'Math', career_id: 'not-a-uuid' }]) {
      const response = await fetch(`${base}/subjects`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'subjects:write' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: 'career_id must be a UUID' });
    }
  });
  assert.equal(repository.calls.create.length, 0);
});

test('GET requires subjects:read and serializes only the envelope and explicit subject fields', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const denied = await fetch(`${base}/subjects`, { headers: { 'x-permission': 'subjects:write' } });
    assert.equal(denied.status, 403);
    const response = await fetch(`${base}/subjects?limit=5&offset=2`, { headers: { 'x-permission': 'subjects:read' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ id: 'subject-1', name: 'Biology', career_id: CAREER_ID, created_by: null, created_at: '2026-02-03T04:05:06.000Z' }], limit: 5, offset: 2 });
  });
  assert.deepEqual(repository.calls.list, [{ careerId: undefined, limit: 5, offset: 2 }]);
});

test('GET forwards the optional career filter and rejects malformed filters before reading', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const filtered = await fetch(`${base}/subjects?career_id=${CAREER_ID}`, { headers: { 'x-permission': 'subjects:read' } });
    assert.equal(filtered.status, 200);
    const malformed = await fetch(`${base}/subjects?career_id=bad`, { headers: { 'x-permission': 'subjects:read' } });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { message: 'career_id must be a UUID' });
  });
  assert.deepEqual(repository.calls.list, [{ careerId: CAREER_ID, limit: 50, offset: 0 }]);
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
