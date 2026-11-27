import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createEndodonticsSubjectRouter } from '../../src/modules/endodontics-subjects/index.ts';
import { PgEndodonticsSubjectRepository } from '../../src/modules/endodontics-subjects/infrastructure/repositories/pg-endodontics-subject.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const subject = '10000000-0000-4000-8000-000000000001';
const actor = '10000000-0000-4000-8000-000000000002';
async function withServer(repository, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = {
      role: req.headers['x-role'], userId: actor,
      permissions: String(req.headers['x-permissions'] ?? '').split(',').filter(Boolean),
    };
    next();
  });
  app.use('/endodontics-subjects', createEndodonticsSubjectRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/endodontics-subjects`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const headers = {
  'content-type': 'application/json', 'x-role': 'admin',
  'x-permissions': 'endodontics-subjects:read,endodontics-subjects:write',
};

test('T1: admin explicitly links and lists subjects without inferring by name', async () => {
  const items = [];
  const repository = {
    async add(subjectId, actorId) { const row = { subject_id: subjectId, career_id: 'career', created_by: actorId }; items.push(row); return row; },
    async list() { return items; },
  };
  await withServer(repository, async base => {
    const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ subject_id: subject }) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { subject_id: subject, career_id: 'career', created_by: actor });
    const listing = await fetch(base, { headers });
    assert.equal(listing.status, 200);
    assert.deepEqual(await listing.json(), { items });
    assert.equal(items.length, 1);
  });
});

test('T1: missing, invalid, non-admin and missing grants fail before repository effects', async () => {
  let calls = 0;
  const repository = { async add() { calls++; }, async list() { calls++; return []; } };
  await withServer(repository, async base => {
    for (const [method, requestHeaders, body, status, code] of [
      ['GET', {}, undefined, 401, 'UNAUTHORIZED'],
      ['GET', { ...headers, 'x-role': 'teacher' }, undefined, 403, 'FORBIDDEN'],
      ['GET', { ...headers, 'x-permissions': 'endodontics-subjects:write' }, undefined, 403, 'FORBIDDEN'],
      ['POST', { ...headers, 'x-permissions': 'endodontics-subjects:read' }, JSON.stringify({ subject_id: subject }), 403, 'FORBIDDEN'],
    ]) {
      const response = await fetch(base, { method, headers: requestHeaders, body });
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
    for (const body of [{}, { subject_id: 8 }, { subject_id: 'not-a-uuid' }, { subject_id: subject, career_id: subject }]) {
      const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
  });
  assert.equal(calls, 0);
});

test('T1: repository inserts only existing odontology subjects and reports duplicates', async () => {
  const queries = [];
  const repository = new PgEndodonticsSubjectRepository({ async query(sql, params) {
    queries.push({ sql, params });
    if (queries.length === 1) return { rows: [] };
    throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'endodontics_subjects_pkey' });
  } });
  await assert.rejects(repository.add(subject, actor), { statusCode: 404, message: 'odontology subject was not found' });
  assert.match(queries[0].sql, /INSERT INTO endodontics_subjects/);
  assert.match(queries[0].sql, /c\.code = 'odontology'/);
  assert.deepEqual(queries[0].params, [subject, actor]);
  await assert.rejects(repository.add(subject, actor), { statusCode: 409, message: 'subject is already enabled for endodontics' });
});

test('T1: migrations constrain explicit odontology links and grant admin read/write separately', () => {
  const sql = readFileSync('src/db/migrations/065_create_endodontics_subjects.sql', 'utf8')
    + readFileSync('src/db/migrations/066_seed_endodontics_subject_permissions.sql', 'utf8');
  assert.match(sql, /CREATE TABLE endodontics_subjects/);
  assert.match(sql, /CHECK \(career_code = 'odontology'\)/);
  assert.match(sql, /FOREIGN KEY \(subject_id, career_id\) REFERENCES subjects \(id, career_id\)/);
  assert.match(sql, /FOREIGN KEY \(career_id, career_code\) REFERENCES careers \(id, code\)/);
  assert.match(sql, /created_by UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /\('admin', 'endodontics-subjects:read'\)/);
  assert.match(sql, /\('admin', 'endodontics-subjects:write'\)/);
  assert.doesNotMatch(sql, /\('(student|estudiante|teacher|reception)',/);
  assert.doesNotMatch(sql, /careers_id_code_unique/);
});
