import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createPatientAssignmentRouter } from '../../src/modules/patient-assignments/infrastructure/routes/patient-assignment.routes.ts';
import { PgPatientAssignmentRepository } from '../../src/modules/patient-assignments/infrastructure/repositories/pg-patient-assignment.repository.ts';
import { createPatientAssignmentOptionsRouter, PgPatientAssignmentOptionsRepository } from '../../src/modules/patient-assignment-options/index.ts';

const ID = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'b0000000-0000-4000-8000-000000000002';
const fields = { patient_id: 'a.patient_id', student_id: 'p.student_id', subject_id: 'a.subject_id', academic_group_id: 'p.academic_group_id' };
const assignment = { id: '1', patient_id: ID, student_habilitation_id: ID, subject_id: ID, academic_group_id: ID,
  assigned_by: ID, assigned_at: '2026-01-01T00:00:00.000Z', ended_by: null, ended_at: null, end_reason: null };
const student = { student_habilitation_id: ID, student_id: ID, nombres: 'Ada', apellidos: 'Lovelace' };

async function serve(router, run) {
  const app = express();
  app.use(router);
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: { code: error.code, message: error.message } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const guard = { async authorize() {} };

// Drive the public HTTP handler through its real service and PostgreSQL adapter.
// The query recorder proves binding/scope structure, not real PostgreSQL execution.
test('assignment UUID filters bind before pagination and intersect teacher/own scopes', async () => {
  const calls = [];
  const repository = new PgPatientAssignmentRepository({ withTransaction() { assert.fail('read must not mutate'); } }, {
    async query(sql, params) { calls.push({ sql, params }); return { rows: [assignment] }; },
  });
  await serve(createPatientAssignmentRouter({ repository, readGuard: guard, ownGuard: guard, getActor: async () => ID }), async base => {
    for (const route of ['/', '/mine']) {
      for (const [field, column] of Object.entries(fields)) {
        const response = await fetch(`${base}${route}?${field}=${OTHER.toUpperCase()}&limit=1&offset=2`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { items: [assignment], limit: 1, offset: 2 });
        const { sql, params } = calls.at(-1);
        assert.match(sql, new RegExp(`AND ${column.replace('.', '\\.')} = \\$4`));
        assert.deepEqual(params, [ID, 1, 2, OTHER]);
        assert.match(sql, /a\.ended_at IS NULL AND p\.revoked_at IS NULL/);
        assert.match(sql, route === '/' ? /th\.revoked_at IS NULL/ : /p\.student_id = \(SELECT id FROM students WHERE user_id = \$1\)/);
        assert.ok(sql.indexOf(`${column} = $4`) < sql.indexOf('ORDER BY a.id LIMIT $2 OFFSET $3'));
      }
      const all = new URLSearchParams(Object.keys(fields).map(field => [field, OTHER]));
      const response = await fetch(`${base}${route}?${all}`);
      assert.equal(response.status, 200);
      assert.deepEqual(calls.at(-1).params, [ID, 50, 0, OTHER, OTHER, OTHER, OTHER]);
      for (const [index, column] of Object.values(fields).entries()) {
        assert.ok(calls.at(-1).sql.includes(`AND ${column} = $${index + 4}`));
      }
      for (const field of Object.keys(fields)) {
        for (const value of ['', 'bad', `${ID}&${field}=${OTHER}`]) {
          const before = calls.length;
          const invalid = await fetch(`${base}${route}?${field}=${value}`);
          assert.equal(invalid.status, 400);
          assert.deepEqual(await invalid.json(), { error: { code: 'BAD_REQUEST', message: `${field} must be a UUID` } });
          assert.equal(calls.length, before);
        }
      }
      const legacy = await fetch(`${base}${route}`);
      assert.equal(legacy.status, 200);
      assert.deepEqual(await legacy.json(), { items: [assignment], limit: 50, offset: 0 });
      assert.deepEqual(calls.at(-1).params, [ID, 50, 0]);
    }
  });
});

test('eligible student q is literal, bounded, optional and subordinate to live teacher context', async () => {
  const calls = [];
  const repository = new PgPatientAssignmentOptionsRepository({ async query(sql, params) { calls.push({ sql, params }); return { rows: [student] }; } });
  await serve(createPatientAssignmentOptionsRouter({ repository, writeGuard: guard, habilitationReadGuard: guard, getActor: async () => ID }), async base => {
    const path = `${base}/students?subject_id=${ID}&academic_group_id=${OTHER}`;
    for (const q of [' Ada ', '%_\\', 'x'.repeat(100)]) {
      const response = await fetch(`${path}&q=${encodeURIComponent(q)}&limit=1&offset=2`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { items: [student], limit: 1, offset: 2 });
      const { sql, params } = calls.at(-1);
      assert.deepEqual(params, [ID, ID, OTHER, 1, 2, '%' + q.trim().replace(/[\\%_]/g, '\\$&') + '%']);
      assert.match(sql, /AND \(student\.nombres ILIKE \$6 OR student\.apellidos ILIKE \$6\)/);
      assert.match(sql, /t\.user_id = \$1 AND th\.subject_id = \$2 AND th\.academic_group_id = \$3/);
      assert.match(sql, /th\.revoked_at IS NULL AND period\.revoked_at IS NULL/);
      assert.match(sql, /ORDER BY student\.nombres ASC, student\.apellidos ASC, student\.id ASC, period\.id ASC/);
    }
    for (const query of ['', '&q=', '&q=%20%20']) {
      const response = await fetch(path + query);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { items: [student], limit: 50, offset: 0 });
      assert.deepEqual(calls.at(-1).params, [ID, ID, OTHER, 50, 0]);
      assert.doesNotMatch(calls.at(-1).sql, /ILIKE/);
    }
    for (const query of [`&q=${'x'.repeat(101)}`, '&q=a&q=b']) {
      const before = calls.length;
      const response = await fetch(path + query);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: 'q must be a string of at most 100 characters' } });
      assert.equal(calls.length, before);
    }
    const before = calls.length;
    const missingContext = await fetch(`${base}/students?q=Ada`);
    assert.equal(missingContext.status, 400);
    assert.deepEqual(await missingContext.json(), { error: { code: 'BAD_REQUEST', message: 'subject_id must be a UUID' } });
    assert.equal(calls.length, before);
  });
});
