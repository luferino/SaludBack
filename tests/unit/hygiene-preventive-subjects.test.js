import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHygienePreventiveSubjectRouter } from '../../src/modules/hygiene-preventive-subjects/index.ts';
import { PgHygienePreventiveSubjectRepository } from '../../src/modules/hygiene-preventive-subjects/infrastructure/repositories/pg-hygiene-preventive-subject.repository.ts';
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
  app.use('/hygiene-preventive-subjects', createHygienePreventiveSubjectRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/hygiene-preventive-subjects`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const headers = {
  'content-type': 'application/json', 'x-role': 'admin',
  'x-permissions': 'hygiene-preventive-subjects:read,hygiene-preventive-subjects:write',
};

test('S5: admin explicitly enables multiple subjects and lists the resulting links', async () => {
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

test('S5: role, permissions and payload validation reject before any repository call', async () => {
  let calls = 0;
  const repository = { async add() { calls++; }, async list() { calls++; return []; } };
  await withServer(repository, async base => {
    for (const [requestHeaders, status, code] of [
      [{}, 401, 'UNAUTHORIZED'], [{ ...headers, 'x-role': 'teacher' }, 403, 'FORBIDDEN'],
      [{ ...headers, 'x-permissions': 'oral-surgery-subjects:read,oral-surgery-subjects:write' }, 403, 'FORBIDDEN'],
    ]) {
      for (const method of ['POST', 'GET']) {
        const response = await fetch(base, { method, headers: requestHeaders, body: method === 'POST' ? '{}' : undefined });
        assert.equal(response.status, status, `${method} ${status}`);
        assert.equal((await response.json()).error.code, code);
      }
    }
    for (const body of [{}, { subject_id: 5 }, { subject_id: 'not-a-uuid' }, { subject_id: subject, career_id: subject }]) {
      const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.deepEqual((await response.json()).error.code, 'BAD_REQUEST');
    }
    for (const method of ['PATCH', 'DELETE']) {
      assert.equal((await fetch(base, { method, headers, body: '{}' })).status, 404);
    }
  });
  assert.equal(calls, 0);
});

test('S5: PG link creation filters by odontology career, preserves actor and reports unavailable subjects', async () => {
  const queries = [];
  const repository = new PgHygienePreventiveSubjectRepository({ async query(sql, params) {
    queries.push({ sql, params }); return { rows: [] };
  } });
  await assert.rejects(repository.add(subject, actor), { statusCode: 404, message: 'odontology subject was not found' });
  assert.match(queries[0].sql, /c.code = 'odontology'/);
  assert.match(queries[0].sql, /INSERT INTO hygiene_preventive_subjects/);
  assert.deepEqual(queries[0].params, [subject, actor]);
});

test('S5: duplicate links return a stable conflict, other SQL failures propagate', async () => {
  const duplicate = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'hygiene_preventive_subjects_pkey' });
  const repository = new PgHygienePreventiveSubjectRepository({ async query() { throw duplicate; } });
  await assert.rejects(repository.add(subject, actor),
    { statusCode: 409, message: 'subject is already enabled for hygiene and preventive dentistry' });
  const failure = new Error('unavailable');
  const broken = new PgHygienePreventiveSubjectRepository({ async query() { throw failure; } });
  await assert.rejects(broken.list(), error => error === failure);
  await assert.rejects(broken.add(subject, actor), error => error === failure);
});

test('S5: 054/055 tie subject and career to odontology and grant only admin link permissions', () => {
  const sql = readFileSync('src/db/migrations/054_create_hygiene_preventive_subjects.sql', 'utf8')
    + readFileSync('src/db/migrations/055_seed_hygiene_preventive_subject_permissions.sql', 'utf8');
  assert.match(sql, /CREATE TABLE hygiene_preventive_subjects/);
  assert.match(sql, /CHECK \(career_code = 'odontology'\)/);
  assert.match(sql, /FOREIGN KEY \(subject_id, career_id\) REFERENCES subjects \(id, career_id\)/);
  assert.match(sql, /FOREIGN KEY \(career_id, career_code\) REFERENCES careers \(id, code\)/);
  assert.match(sql, /created_by UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /\('admin', 'hygiene-preventive-subjects:read'\)/);
  assert.match(sql, /\('admin', 'hygiene-preventive-subjects:write'\)/);
  assert.doesNotMatch(sql, /\('(?:student|estudiante|teacher|reception)',/);
  assert.doesNotMatch(sql, /careers_id_code_unique/, 'the 038 constraint is reused, never re-created');
});
