import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createOralSurgerySubjectRouter } from '../../src/modules/oral-surgery-subjects/index.ts';
import { PgOralSurgerySubjectRepository } from '../../src/modules/oral-surgery-subjects/infrastructure/repositories/pg-oral-surgery-subject.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const actor = '10000000-0000-4000-8000-000000000002';
const permission = 'oral-surgery-drafts:read';
const link = { subject_id: '10000000-0000-4000-8000-000000000011', academic_group_id: '10000000-0000-4000-8000-000000000021' };

async function withServer(repository, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = {
      role: req.headers['x-role'], userId: req.headers['x-user-id'] ?? actor,
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

function auth(role, extra = {}) {
  return { 'x-role': role, 'x-permissions': permission, ...extra };
}

test('mine returns only the caller role contexts, with no-store and actor/role forwarded', async () => {
  const calls = [];
  const repository = {
    async add() { throw new Error('unexpected add'); }, async list() { throw new Error('unexpected list'); },
    async listMine(userId, role) { calls.push([userId, role]); return [{ ...link, patient_id: 'must-not-leak', user_id: 'must-not-leak' }]; },
  };
  await withServer(repository, async base => {
    for (const role of ['estudiante', 'teacher']) {
      const response = await fetch(`${base}/mine`, { headers: auth(role, { 'x-user-id': actor }) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { items: [link] });
    }
  });
  assert.deepEqual(calls, [[actor, 'estudiante'], [actor, 'teacher']]);
});

test('mine rejects anonymous, missing permission, unsupported roles and every query parameter before repository access', async () => {
  let calls = 0;
  const repository = {
    async add() {}, async list() { return []; }, async listMine() { calls++; return []; },
  };
  await withServer(repository, async base => {
    const cases = [
      [undefined, 401, undefined, '/mine'],
      [auth('estudiante', { 'x-permissions': '' }), 403, "Permission 'oral-surgery-drafts:read' required", '/mine'],
      [auth('admin'), 403, 'estudiante or teacher role required', '/mine'],
      [auth('student'), 403, 'estudiante or teacher role required', '/mine'],
      [auth('estudiante'), 400, 'query parameters are not supported', '/mine?subject_id=anything'],
    ];
    for (const [headers, status, message, path] of cases) {
      const response = await fetch(`${base}${path}`, { headers: headers ?? {} });
      assert.equal(response.status, status);
      if (message) assert.equal((await response.json()).error.message, message);
    }
    const malformed = await fetch(`${base}/mine`, { headers: auth('estudiante', { 'x-user-id': 'not-a-uuid' }) });
    assert.equal(malformed.status, 401);
    assert.equal((await malformed.json()).error.message, 'A verified UUID actor is required');
  });
  assert.equal(calls, 0);
});

test('mine exposes only enabled active contexts for the authenticated role, not revoked or secondary-profile contexts', async () => {
  const active = { subject_id: link.subject_id, academic_group_id: link.academic_group_id };
  const other = { subject_id: '10000000-0000-4000-8000-000000000012', academic_group_id: link.academic_group_id };
  const repository = {
    async add() {}, async list() { return []; },
    async listMine(userId, role) {
      const contexts = [
        { userId: actor, role: 'estudiante', active: true, enabled: true, pair: active },
        { userId: actor, role: 'estudiante', active: false, enabled: true, pair: other },
        { userId: actor, role: 'teacher', active: true, enabled: false, pair: other },
        { userId: '10000000-0000-4000-8000-000000000099', role, active: true, enabled: true, pair: other },
      ];
      return contexts.filter(row => row.userId === userId && row.role === role && row.active && row.enabled).map(row => row.pair);
    },
  };
  await withServer(repository, async base => {
    for (const role of ['estudiante', 'teacher']) {
      const response = await fetch(`${base}/mine`, { headers: auth(role) });
      assert.deepEqual(await response.json(), { items: role === 'estudiante' ? [active] : [] });
    }
  });
});

test('mine does not reveal profiles, clinical identifiers or administrative link catalogue; root behavior remains admin-only', async () => {
  const repository = {
    async add(subjectId, actorId) { return { subject_id: subjectId, created_by: actorId }; },
    async list() { return [{ subject_id: link.subject_id, career_id: 'career', created_by: actor, created_at: 'date' }]; },
    async listMine() { return [link]; },
  };
  await withServer(repository, async base => {
    const mine = await fetch(`${base}/mine`, { headers: auth('teacher') });
    const body = await mine.json();
    assert.deepEqual(Object.keys(body), ['items']);
    assert.deepEqual(Object.keys(body.items[0]).sort(), ['academic_group_id', 'subject_id']);
    for (const role of ['estudiante', 'teacher']) {
      assert.equal((await fetch(base, { headers: auth(role) })).status, 403);
      assert.equal((await fetch(base, { method: 'POST', headers: auth(role, { 'content-type': 'application/json' }), body: JSON.stringify({ subject_id: link.subject_id }) })).status, 403);
    }
    assert.equal((await fetch(base, { headers: auth('admin', { 'x-permissions': 'oral-surgery-subjects:read' }) })).status, 200);
    assert.equal((await fetch(base, { method: 'POST', headers: auth('admin', { 'x-permissions': 'oral-surgery-subjects:write', 'content-type': 'application/json' }), body: JSON.stringify({ subject_id: link.subject_id }) })).status, 201);
  });
});

test('PG own-context query parameterizes actor and role and intersects only active enabled links', async () => {
  const queries = [];
  const repository = new PgOralSurgerySubjectRepository({ async query(sql, params) {
    queries.push({ sql, params }); return { rows: [link] };
  } });
  await repository.listMine(actor, 'teacher');
  assert.deepEqual(queries[0].params, [actor, 'teacher']);
  const sql = queries[0].sql;
  for (const fragment of [
    'SELECT DISTINCT', 'oral_surgery_subjects', 'student_academic_habilitations',
    'teacher_academic_habilitations', 's.user_id', 't.user_id',
    'revoked_at IS NULL', 'contexts.subject_id = link.subject_id', 'ORDER BY subject_id, academic_group_id',
  ]) assert.ok(sql.includes(fragment), `query should include ${fragment}`);
  assert.match(sql, /student_academic_habilitations[\s\S]*s\.user_id = \$1 AND \$2 = 'estudiante'/);
  assert.match(sql, /teacher_academic_habilitations[\s\S]*t\.user_id = \$1 AND \$2 = 'teacher'/);
  assert.doesNotMatch(sql, /\$\{[^}]+\}/);
});
