import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createGroupRouter } from '../../src/modules/groups/infrastructure/routes/group.routes.ts';
import { Group } from '../../src/modules/groups/domain/group.entity.ts';

async function withServer(repository, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const permission = req.headers['x-permission'];
    if (permission) req.auth = { userId: 'verified-actor', permissions: [permission], role: 'teacher' };
    next();
  });
  app.use('/groups', createGroupRouter({ repository }));
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
    async create(group) {
      calls.create.push(group);
      return new Group({ ...group, id: 'group-1', createdAt: new Date('2026-02-03T04:05:06Z') });
    },
    async list(options) {
      calls.list.push(options);
      return [new Group({ id: 'group-1', academicYear: 2026, curriculumSemester: 7, name: 'Physics', createdBy: null, createdAt: '2026-02-03T04:05:06Z' })];
    },
  };
}

test('POST requires groups:write and uses verified nullable actor, ignoring body attribution', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const denied = await fetch(`${base}/groups`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'groups:read' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 1, name: 'Math' }) });
    assert.equal(denied.status, 403);
    const response = await fetch(`${base}/groups`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'groups:write' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 7, name: '  Physics  ', createdBy: 'spoofed', created_by: 'spoofed', actor: 'spoofed' }) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'group-1', academic_year: 2026, curriculum_semester: 7, name: 'Physics', created_by: 'verified-actor', created_at: '2026-02-03T04:05:06.000Z' });
  });
  assert.equal(repository.calls.create.length, 1);
  assert.equal(repository.calls.create[0].createdBy, 'verified-actor');
});

test('GET requires groups:read, preserves raw query values, and explicitly serializes items', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await fetch(`${base}/groups`, { headers: { 'x-permission': 'groups:write' } })).status, 403);
    const response = await fetch(`${base}/groups?limit=5&offset=2`, { headers: { 'x-permission': 'groups:read' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ id: 'group-1', academic_year: 2026, curriculum_semester: 7, name: 'Physics', created_by: null, created_at: '2026-02-03T04:05:06.000Z' }], limit: 5, offset: 2 });
    assert.equal((await fetch(`${base}/groups?limit=1&limit=2`, { headers: { 'x-permission': 'groups:read' } })).status, 400);
  });
  assert.deepEqual(repository.calls.list, [{ limit: 5, offset: 2 }]);
});

test('missing authentication and malformed create bodies follow existing error responses', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await fetch(`${base}/groups`)).status, 401);
    const invalid = await fetch(`${base}/groups`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'groups:write' }, body: JSON.stringify({ academic_year: '2026', curriculum_semester: 0, name: '' }) });
    assert.equal(invalid.status, 400);
  });
  assert.equal(repository.calls.create.length, 0);
});
