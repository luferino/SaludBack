import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { ConflictError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { SubjectGroup } from '../../src/modules/subject-groups/domain/subject-group.entity.ts';
import { createSubjectGroupRouter } from '../../src/modules/subject-groups/infrastructure/routes/subject-group.routes.ts';

const SUBJECT_ID = '10000000-0000-4000-8000-000000000001';
const GROUP_ID = '20000000-0000-4000-8000-000000000002';

async function withServer(repository, run, { nullableActor = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const permission = req.headers['x-permission'];
    if (permission) req.auth = { ...(nullableActor ? {} : { userId: 'verified-actor' }), permissions: [permission], role: 'teacher' };
    next();
  });
  app.use('/subject-groups', createSubjectGroupRouter({ repository }));
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
  const calls = { create: [], list: [] };
  return {
    calls,
    async create(association) {
      calls.create.push(association);
      return new SubjectGroup({ ...association, createdAt: new Date('2026-02-03T04:05:06Z') });
    },
    async list(options) {
      calls.list.push(options);
      return [new SubjectGroup({ subjectId: SUBJECT_ID, academicGroupId: GROUP_ID, createdBy: null, createdAt: '2026-02-03T04:05:06Z' })];
    },
  };
}

function jsonHeaders(permission) {
  return { 'content-type': 'application/json', 'x-permission': permission };
}

test('POST requires write permission, uses nullable verified actor and serializes only association fields', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const denied = await fetch(`${base}/subject-groups`, { method: 'POST', headers: jsonHeaders('subject-groups:read'), body: JSON.stringify({ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID }) });
    assert.equal(denied.status, 403);
    const response = await fetch(`${base}/subject-groups`, {
      method: 'POST', headers: jsonHeaders('subject-groups:write'),
      body: JSON.stringify({ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: 'spoofed', createdBy: 'spoofed', actor: 'spoofed' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: 'verified-actor', created_at: '2026-02-03T04:05:06.000Z' });
    assert.equal((await fetch(`${base}/subject-groups`, { method: 'POST', headers: jsonHeaders('subject-groups:write'), body: JSON.stringify({ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: 'spoofed' }) })).status, 201);
  });
  assert.equal(repository.calls.create.length, 2);
  assert.equal(repository.calls.create[0].createdBy, 'verified-actor');
});

test('POST preserves a nullable verified actor and never trusts client attribution', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    const response = await fetch(`${base}/subject-groups`, {
      method: 'POST', headers: jsonHeaders('subject-groups:write'),
      body: JSON.stringify({ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: 'spoofed' }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).created_by, null);
  }, { nullableActor: true });
  assert.equal(repository.calls.create.at(-1).createdBy, null);
});

test('GET requires read permission, forwards raw filters and pagination, and explicitly serializes the page', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await fetch(`${base}/subject-groups`, { headers: { 'x-permission': 'subject-groups:write' } })).status, 403);
    const response = await fetch(`${base}/subject-groups?subject_id=${SUBJECT_ID}&limit=5&offset=2`, { headers: { 'x-permission': 'subject-groups:read' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID, created_by: null, created_at: '2026-02-03T04:05:06.000Z' }], limit: 5, offset: 2 });
    for (const query of [`?subject_id=${SUBJECT_ID}&subject_id=${GROUP_ID}`, '?limit=1&limit=2', '?offset=0&offset=1']) {
      assert.equal((await fetch(`${base}/subject-groups${query}`, { headers: { 'x-permission': 'subject-groups:read' } })).status, 400);
    }
  });
  assert.deepEqual(repository.calls.list, [{ subjectId: SUBJECT_ID, limit: 5, offset: 2 }]);
});

test('invalid association input, duplicate, missing references and unexpected failures map through the shared handler', async () => {
  const calls = [];
  const repository = {
    async create(value) {
      calls.push(value);
      if (value.subjectId === GROUP_ID) throw new ConflictError('subject is already associated with academic group');
      if (value.academicGroupId === SUBJECT_ID) throw new NotFoundError('subject or academic group was not found');
      if (value.subjectId === '30000000-0000-4000-8000-000000000003') throw new Error('internal detail');
      return value;
    },
    async list() { return []; },
  };
  await withServer(repository, async (base) => {
    const post = (body) => fetch(`${base}/subject-groups`, { method: 'POST', headers: jsonHeaders('subject-groups:write'), body: JSON.stringify(body) });
    assert.equal((await post({ subject_id: 'not-uuid', academic_group_id: GROUP_ID })).status, 400);
    assert.equal((await post({ subject_id: SUBJECT_ID, academic_group_id: GROUP_ID })).status, 201);
    const duplicate = await post({ subject_id: GROUP_ID, academic_group_id: GROUP_ID });
    assert.equal(duplicate.status, 409);
    assert.deepEqual((await duplicate.json()).error, { code: 'CONFLICT', message: 'subject is already associated with academic group' });
    const missing = await post({ subject_id: SUBJECT_ID, academic_group_id: SUBJECT_ID });
    assert.equal(missing.status, 404);
    assert.deepEqual((await missing.json()).error, { code: 'NOT_FOUND', message: 'subject or academic group was not found' });
    const unexpected = await post({ subject_id: '30000000-0000-4000-8000-000000000003', academic_group_id: GROUP_ID });
    assert.equal(unexpected.status, 500);
    assert.deepEqual((await unexpected.json()).error, { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
  });
  assert.equal(calls.length, 4);
});

test('missing authentication and invalid filters fail before repository calls', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await fetch(`${base}/subject-groups`)).status, 401);
    for (const query of ['?subject_id=bad', '?subject_id=%20' + SUBJECT_ID, '?limit=1e2', '?offset=-1']) {
      assert.equal((await fetch(`${base}/subject-groups${query}`, { headers: { 'x-permission': 'subject-groups:read' } })).status, 400);
    }
  });
  assert.equal(repository.calls.list.length, 0);
});
