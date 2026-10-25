import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createPatientAssignmentOptionsRouter, PgPatientAssignmentOptionsRepository } from '../../src/modules/patient-assignment-options/index.ts';

const ACTOR = '40000000-0000-4000-8000-000000000001';
const SUBJECT = '10000000-0000-4000-8000-000000000001';
const GROUP = '20000000-0000-4000-8000-000000000001';
const PERIOD = '60000000-0000-4000-8000-000000000001';
const STUDENT = '30000000-0000-4000-8000-000000000001';
const context = { subject_id: SUBJECT, subject_name: 'Anatomía', academic_group_id: GROUP,
  academic_group_name: 'Grupo A', academic_year: 2026, curriculum_semester: 1, documento: 'PRIVATE', email: 'private@example.invalid' };
const student = { student_habilitation_id: PERIOD, student_id: STUDENT, nombres: 'Ada', apellidos: 'Lovelace', email: 'private@example.invalid' };

async function withRouter(repository, run, options = {}) {
  const app = express();
  app.use(express.json());
  app.use(createPatientAssignmentOptionsRouter({ repository, getActor: async () => Object.hasOwn(options, 'actor') ? options.actor : ACTOR,
    writeGuard: options.writeGuard ?? { authorize: async () => {} },
    habilitationReadGuard: options.habilitationReadGuard ?? { authorize: async () => {} } }));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: { code: error.code ?? 'INTERNAL_SERVER_ERROR', message: error.message } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const request = (base, path) => fetch(`${base}${path}`);

test('contexts require scoped repositories and return only named context fields with pagination', async () => {
  const calls = [];
  await withRouter({
    async listContexts(...args) { calls.push(['contexts', ...args]); return [context]; },
    async listStudents(...args) { calls.push(['students', ...args]); return [student]; },
  }, async base => {
    const response = await request(base, '/contexts?limit=1&offset=2');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { items: [{ subject_id: SUBJECT, subject_name: 'Anatomía', academic_group_id: GROUP,
      academic_group_name: 'Grupo A', academic_year: 2026, curriculum_semester: 1 }], limit: 1, offset: 2 });
  });
  assert.deepEqual(calls, [['contexts', ACTOR, 1, 2]]);
});

test('student options require exact UUID context and expose only habilitation, student ID, and names', async () => {
  const calls = [];
  await withRouter({
    async listContexts(...args) { calls.push(['contexts', ...args]); return []; },
    async listStudents(...args) { calls.push(['students', ...args]); return [student]; },
  }, async base => {
    const response = await request(base, `/students?subject_id=${SUBJECT}&academic_group_id=${GROUP}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { items: [{ student_habilitation_id: PERIOD, student_id: STUDENT, nombres: 'Ada', apellidos: 'Lovelace' }], limit: 50, offset: 0 });
    const malformed = await request(base, `/students?subject_id=${SUBJECT}&academic_group_id=${GROUP}&limit=1&limit=2`);
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: { code: 'BAD_REQUEST', message: 'limit must be an integer' } });
    const invalidContext = await request(base, `/students?subject_id=bad&academic_group_id=${GROUP}`);
    assert.equal(invalidContext.status, 400);
    assert.deepEqual(await invalidContext.json(), { error: { code: 'BAD_REQUEST', message: 'subject_id must be a UUID' } });
  });
  assert.deepEqual(calls, [['students', ACTOR, SUBJECT, GROUP, 50, 0]]);
});

test('both permission guards run before a scoped repository call', async () => {
  const seen = [];
  await withRouter({ async listContexts(actor, limit, offset) { seen.push(['repository', actor, limit, offset]); return []; }, async listStudents() { return []; } }, async base => {
    const response = await request(base, '/contexts');
    assert.equal(response.status, 200);
  }, {
    writeGuard: { async authorize() { seen.push('patient-assignments:write'); } },
    habilitationReadGuard: { async authorize() { seen.push('student-habilitations:read'); } },
  });
  assert.deepEqual(seen, ['patient-assignments:write', 'student-habilitations:read', ['repository', ACTOR, 50, 0]]);
});

test('both permissions and a verified actor are required before repository access', async () => {
  for (const [options, status, expected] of [
    [{ writeGuard: { authorize: async () => { throw Object.assign(new Error('write denied'), { statusCode: 403, code: 'FORBIDDEN' }); } } }, 403, { error: { code: 'FORBIDDEN', message: 'write denied' } }],
    [{ habilitationReadGuard: { authorize: async () => { throw Object.assign(new Error('read denied'), { statusCode: 403, code: 'FORBIDDEN' }); } } }, 403, { error: { code: 'FORBIDDEN', message: 'read denied' } }],
    [{ actor: null }, 401, { error: { code: 'UNAUTHORIZED', message: 'A verified UUID actor is required' } }],
  ]) {
    let accessed = false;
    await withRouter({ async listContexts() { accessed = true; return []; }, async listStudents() { accessed = true; return []; } }, async base => {
      const response = await request(base, '/contexts');
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), expected);
    }, options);
    assert.equal(accessed, false);
  }
});

test('pagination rejects bounds, malformed values, duplicate arrays, and offset above 10000', async () => {
  const repository = { async listContexts() { return []; }, async listStudents() { return []; } };
  await withRouter(repository, async base => {
    for (const query of ['?limit=0', '?limit=101', '?offset=-1', '?offset=10001', '?limit=1&limit=2', '?offset=1.5']) {
      const response = await request(base, `/contexts${query}`);
      assert.equal(response.status, 400, query);
    }
  });
});

test('PostgreSQL selectors enforce live teacher scope, active periods, names, deterministic ordering, and minimal selects', async () => {
  const statements = [];
  const pool = { async query(sql, params) {
    statements.push({ sql, params });
    return { rows: sql.includes('JOIN subjects') ? [context] : [student] };
  } };
  const repository = new PgPatientAssignmentOptionsRepository(pool);
  await repository.listContexts(ACTOR, 50, 0);
  await repository.listStudents(ACTOR, SUBJECT, GROUP, 50, 0);
  assert.match(statements[0].sql, /t\.user_id = \$1 AND th\.revoked_at IS NULL/);
  assert.match(statements[0].sql, /EXISTS \([\s\S]*student_academic_habilitations[\s\S]*period\.revoked_at IS NULL/);
  assert.match(statements[0].sql, /ORDER BY s\.name ASC, s\.id ASC, ag\.name ASC, ag\.id ASC/);
  assert.match(statements[1].sql, /th\.subject_id = \$2 AND th\.academic_group_id = \$3/);
  assert.match(statements[1].sql, /th\.revoked_at IS NULL AND period\.revoked_at IS NULL/);
  assert.match(statements[1].sql, /ORDER BY student\.nombres ASC, student\.apellidos ASC, student\.id ASC, period\.id ASC/);
  assert.deepEqual(statements.map(query => query.params), [[ACTOR, 50, 0], [ACTOR, SUBJECT, GROUP, 50, 0]]);
  assert.doesNotMatch(statements[1].sql, /email|documento|celular|direccion|fecha_nacimiento/i);
});
