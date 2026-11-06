import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createGroupRouter } from '../../src/modules/groups/infrastructure/routes/group.routes.ts';
import { Group } from '../../src/modules/groups/domain/group.entity.ts';

const CAREER_ID = '11111111-1111-4111-8111-111111111111';

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
      return [new Group({ id: 'group-1', academicYear: 2026, curriculumSemester: 7, name: 'Physics', careerId: CAREER_ID, createdBy: null, createdAt: '2026-02-03T04:05:06Z' })];
    },
  };
}

test('POST requires groups:write and uses verified nullable actor, ignoring body attribution', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const denied = await fetch(`${base}/groups`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'groups:read' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 1, name: 'Math', career_id: CAREER_ID }) });
    assert.equal(denied.status, 403);
    const response = await fetch(`${base}/groups`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'groups:write' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 7, name: '  Physics  ', career_id: CAREER_ID, createdBy: 'spoofed', created_by: 'spoofed', actor: 'spoofed' }) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'group-1', academic_year: 2026, curriculum_semester: 7, name: 'Physics', career_id: CAREER_ID, created_by: 'verified-actor', created_at: '2026-02-03T04:05:06.000Z' });
  });
  assert.equal(repository.calls.create.length, 1);
  assert.equal(repository.calls.create[0].createdBy, 'verified-actor');
  assert.equal(repository.calls.create[0].careerId, CAREER_ID);
});

test('POST without a canonical career_id is a 400 with the exact message and never reaches the repository', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    for (const career_id of [undefined, 'not-a-uuid']) {
      const response = await fetch(`${base}/groups`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'groups:write' }, body: JSON.stringify({ academic_year: 2026, curriculum_semester: 1, name: 'Math', career_id }) });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: 'career_id must be a UUID' });
    }
  });
  assert.equal(repository.calls.create.length, 0);
});

test('GET requires groups:read, preserves raw query values, and explicitly serializes items with the career', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await fetch(`${base}/groups`, { headers: { 'x-permission': 'groups:write' } })).status, 403);
    const response = await fetch(`${base}/groups?limit=5&offset=2`, { headers: { 'x-permission': 'groups:read' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ id: 'group-1', academic_year: 2026, curriculum_semester: 7, name: 'Physics', career_id: CAREER_ID, created_by: null, created_at: '2026-02-03T04:05:06.000Z' }], limit: 5, offset: 2 });
    assert.equal((await fetch(`${base}/groups?limit=1&limit=2`, { headers: { 'x-permission': 'groups:read' } })).status, 400);
  });
  assert.deepEqual(repository.calls.list, [{ careerId: undefined, limit: 5, offset: 2 }]);
});

test('GET forwards the optional career filter and rejects a malformed one before reading', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await fetch(`${base}/groups?career_id=${CAREER_ID}`, { headers: { 'x-permission': 'groups:read' } })).status, 200);
    const malformed = await fetch(`${base}/groups?career_id=bad`, { headers: { 'x-permission': 'groups:read' } });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { message: 'career_id must be a UUID' });
  });
  assert.deepEqual(repository.calls.list, [{ careerId: CAREER_ID, limit: 50, offset: 0 }]);
});

test('missing authentication and malformed create bodies follow existing error responses', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await fetch(`${base}/groups`)).status, 401);
    const invalid = await fetch(`${base}/groups`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-permission': 'groups:write' }, body: JSON.stringify({ academic_year: '2026', curriculum_semester: 0, name: '', career_id: CAREER_ID }) });
    assert.equal(invalid.status, 400);
  });
  assert.equal(repository.calls.create.length, 0);
});
