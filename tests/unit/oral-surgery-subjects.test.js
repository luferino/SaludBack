import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createOralSurgerySubjectRouter } from '../../src/modules/oral-surgery-subjects/index.ts';
import { PgOralSurgerySubjectRepository } from '../../src/modules/oral-surgery-subjects/infrastructure/repositories/pg-oral-surgery-subject.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const subject = '10000000-0000-4000-8000-000000000001';
const actor = '10000000-0000-4000-8000-000000000002';
async function withServer(repository, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = {
      role: req.headers['x-role'], userId: actor,
      permissions: String(req.headers['x-permissions'] ?? '').split(','),
    };
    next();
  });
  app.use('/oral-surgery-subjects', createOralSurgerySubjectRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/oral-surgery-subjects`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const headers = {
  'content-type': 'application/json', 'x-role': 'admin',
  'x-permissions': 'oral-surgery-subjects:read,oral-surgery-subjects:write',
};

test('admin explicitly enables multiple subjects and lists the resulting links', async () => {
  const items = [];
  const repository = {
    async add(subjectId, actorId) { const row = { subject_id: subjectId, created_by: actorId }; items.push(row); return row; },
    async list() { return items; },
  };
  await withServer(repository, async base => {
    for (const subjectId of [subject, '10000000-0000-4000-8000-000000000003']) {
      const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ subject_id: subjectId }) });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { subject_id: subjectId, created_by: actor });
    }
    const response = await fetch(base, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items });
    assert.equal(items.length, 2);
  });
});

test('role, permissions and payload validation reject before any repository mutation', async () => {
  let calls = 0;
  const repository = { async add() { calls++; }, async list() { calls++; return []; } };
  await withServer(repository, async base => {
    for (const [requestHeaders, status] of [
      [{}, 401], [{ ...headers, 'x-role': 'teacher' }, 403],
      [{ ...headers, 'x-permissions': 'subjects:write' }, 403],
    ]) {
      const response = await fetch(base, { method: 'POST', headers: requestHeaders, body: '{}' });
      assert.equal(response.status, status);
      assert.ok((await response.json()).error.code);
    }
    for (const body of [{}, { subject_id: 5 }, { subject_id: subject, career_id: subject }]) {
      const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
    for (const method of ['PATCH', 'DELETE']) {
      assert.equal((await fetch(base, { method, headers, body: '{}' })).status, 404);
    }
  });
  assert.equal(calls, 0);
});

test('PG link creation filters by career, preserves actor and reports unavailable subjects', async () => {
  const queries = [];
  const repository = new PgOralSurgerySubjectRepository({ async query(sql, params) {
    queries.push({ sql, params }); return { rows: [] };
  } });
  await assert.rejects(repository.add(subject, actor), { statusCode: 404, message: 'odontology subject was not found' });
  assert.match(queries[0].sql, /c.code = 'odontology'/);
  assert.match(queries[0].sql, /INSERT INTO oral_surgery_subjects/);
  assert.deepEqual(queries[0].params, [subject, actor]);
});

test('duplicate links return a stable conflict, other SQL failures propagate', async () => {
  const duplicate = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'oral_surgery_subjects_pkey' });
  const repository = new PgOralSurgerySubjectRepository({ async query() { throw duplicate; } });
  await assert.rejects(repository.add(subject, actor), { statusCode: 409, message: 'subject is already enabled for oral surgery' });
  const failure = new Error('unavailable');
  const broken = new PgOralSurgerySubjectRepository({ async query() { throw failure; } });
  await assert.rejects(broken.list(), error => error === failure);
});

test('038 ties subject and career to odontology and grants only admin link permissions', () => {
  const sql = readFileSync('src/db/migrations/038_create_oral_surgery_subjects.sql', 'utf8')
    + readFileSync('src/db/migrations/039_seed_oral_surgery_subject_permissions.sql', 'utf8');
  assert.match(sql, /CHECK \(career_code = 'odontology'\)/);
  assert.match(sql, /FOREIGN KEY \(subject_id, career_id\) REFERENCES subjects \(id, career_id\)/);
  assert.match(sql, /FOREIGN KEY \(career_id, career_code\) REFERENCES careers \(id, code\)/);
  assert.match(sql, /created_by UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /\('admin', 'oral-surgery-subjects:read'\)/);
  assert.match(sql, /\('admin', 'oral-surgery-subjects:write'\)/);
  assert.doesNotMatch(sql, /\('(?:student|estudiante|teacher)',/);
});
