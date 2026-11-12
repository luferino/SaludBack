import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { createKinesiologyEvaluationRouter } from '../../src/modules/kinesiology-evaluations/infrastructure/routes/kinesiology-evaluation.routes.ts';
import { PgKinesiologyEvaluationRepository } from '../../src/modules/kinesiology-evaluations/infrastructure/repositories/pg-kinesiology-evaluation.repository.ts';
import { createKinesiologyEvolutionRouter } from '../../src/modules/kinesiology-evolutions/infrastructure/routes/kinesiology-evolution.routes.ts';
import { PgKinesiologyEvolutionRepository } from '../../src/modules/kinesiology-evolutions/infrastructure/repositories/pg-kinesiology-evolution.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const patient = '10000000-0000-4000-8000-000000000002';
const headers = { 'x-role': 'estudiante', 'x-permissions': 'kinesiology-evaluations:read,kinesiology-evolutions:read' };
async function serve(router, run) {
  const app = express();
  app.use((req, _res, next) => { req.auth = { userId: user, role: req.headers['x-role'], permissions: String(req.headers['x-permissions'] ?? '').split(',') }; next(); });
  app.use('/evaluations', router.evaluation); app.use('/evolutions', router.evolution); app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
function db() {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  return { calls,
    evaluation: new PgKinesiologyEvaluationRepository({}, pool),
    evolution: new PgKinesiologyEvolutionRepository({}, pool),
  };
}
const routers = (d) => ({
  evaluation: createKinesiologyEvaluationRouter({ repository: d.evaluation, getActor: async () => user }),
  evolution: createKinesiologyEvolutionRouter({ repository: d.evolution, getActor: async () => user }),
});

test('year zero is rejected through both public list endpoints before repository access; years 0001 and 9999 remain valid', async () => {
  const d = db();
  await serve(routers(d), async base => {
    for (const [endpoint, parameter, value] of [
      ['/evaluations', 'date_from', '0000-01-01'], ['/evolutions', 'date_to', '0000-12-31'],
    ]) {
      const response = await fetch(`${base}${endpoint}?patient_id=${patient}&${parameter}=${value}`, { headers });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: `${parameter} must be a real YYYY-MM-DD date` } });
    }
  });
  assert.equal(d.calls.length, 0);
  await serve(routers(d), async base => {
    for (const [endpoint, parameter, value] of [
      ['/evaluations', 'date_from', '0001-01-01'], ['/evolutions', 'date_to', '9999-12-31'],
    ]) assert.equal((await fetch(`${base}${endpoint}?patient_id=${patient}&${parameter}=${value}`, { headers })).status, 200);
  });
  assert.equal(d.calls.length, 2);
});

test('evaluation filters reach SQL as visible CASE projections; omitted filters preserve required patient and scope', async () => {
  const d = db();
  await serve(routers(d), async base => {
    const response = await fetch(`${base}/evaluations?patient_id=${patient}&status=submitted&date_from=2024-02-29&date_to=2024-03-01`, { headers });
    assert.equal(response.status, 200);
    const omitted = await fetch(`${base}/evaluations?patient_id=${patient}`, { headers }); assert.equal(omitted.status, 200);
  });
  assert.deepEqual(d.calls[0].params, [user, patient, 'submitted', '2024-02-29', '2024-03-01']);
  assert.match(d.calls[0].sql, /CASE WHEN \(\(e\.author_id = \$1[\s\S]*?THEN e\.status WHEN validation\.id IS NOT NULL THEN 'validated' ELSE 'submitted' END = \$3/);
  assert.match(d.calls[0].sql, /CASE WHEN \(\(e\.author_id = \$1[\s\S]*?THEN e\.created_at ELSE snapshot\.submitted_at END >= \(\$4::date::timestamp AT TIME ZONE 'UTC'\)/);
  assert.match(d.calls[0].sql, /snapshot\.submitted_at END < \(\(\$5::date \+ INTERVAL '1 day'\)::timestamp AT TIME ZONE 'UTC'\)/);
  assert.doesNotMatch(d.calls[0].sql, /WHERE e\.status\s*=|WHERE e\.created_at\s*[<>]/);
  assert.deepEqual(d.calls[1].params, [user, patient]);
});

test('evolution filters use visible projections and positive BIGINT evaluation_id only', async () => {
  const d = db();
  await serve(routers(d), async base => {
    const response = await fetch(`${base}/evolutions?patient_id=${patient}&status=validated&date_from=2024-02-29&evaluation_id=9223372036854775807`, { headers });
    assert.equal(response.status, 200);
    const omitted = await fetch(`${base}/evolutions?patient_id=${patient}`, { headers }); assert.equal(omitted.status, 200);
  });
  assert.deepEqual(d.calls[0].params, [patient, user, 'validated', '2024-02-29', '9223372036854775807']);
  assert.match(d.calls[0].sql, /CASE WHEN \(\(e\.author_id = \$2[\s\S]*?THEN e\.status ELSE latest\.projected_status END = \$3/);
  assert.match(d.calls[0].sql, /CASE WHEN \(\(e\.author_id = \$2[\s\S]*?THEN e\.created_at ELSE latest\.submitted_at END >= \(\$4::date::timestamp AT TIME ZONE 'UTC'\)/);
  assert.match(d.calls[0].sql, /e\.evaluation_id = \$5::bigint/);
  assert.deepEqual(d.calls[1].params, [patient, user]);
});

test('evolutions accept one-sided date_to and the minimum BIGINT evaluation ID with UTC exclusive upper bound', async () => {
  const d = db();
  await serve(routers(d), async base => {
    const response = await fetch(`${base}/evolutions?patient_id=${patient}&date_to=2024-03-01&evaluation_id=1`, { headers });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(d.calls[0].params, [patient, user, '2024-03-01', '1']);
  assert.match(d.calls[0].sql, /CASE WHEN \(\(e\.author_id = \$2[\s\S]*?THEN e\.created_at ELSE latest\.submitted_at END < \(\(\$3::date \+ INTERVAL '1 day'\)::timestamp AT TIME ZONE 'UTC'\)/);
  assert.match(d.calls[0].sql, /e\.evaluation_id = \$4::bigint/);
});

test('all public list endpoints support each visible status and reject invalid input before repository access', async () => {
  const d = db();
  await serve(routers(d), async base => {
    for (const endpoint of ['/evaluations', '/evolutions']) for (const status of ['draft', 'submitted', 'validated']) {
      const response = await fetch(`${base}${endpoint}?patient_id=${patient}&status=${status}`, { headers });
      assert.equal(response.status, 200);
      const query = d.calls.at(-1);
      assert.equal(query.params.includes(status), true);
      assert.match(query.sql, /CASE WHEN[\s\S]*?END = \$\d/);
    }
    for (const [endpoint, query, message] of [
      ['/evaluations', 'date_from=2024-02-30', 'date_from must be a real YYYY-MM-DD date'],
      ['/evaluations', 'date_to=2024-1-01', 'date_to must be a real YYYY-MM-DD date'],
      ['/evaluations', 'date_from=2024-01-01&date_from=2024-01-02', 'date_from must be a single string'],
      ['/evolutions', 'date_to%5Bday%5D=2024-01-01', 'date_to must be a single string'],
      ['/evaluations', 'date_from=2024-01-02&date_to=2024-01-01', 'date_from must not be after date_to'],
      ['/evolutions', 'status=bad', 'status must be draft, submitted, or validated'],
      ['/evaluations', 'status=draft&status=submitted', 'status must be a single string'],
      ['/evolutions', 'status%5Bvalue%5D=draft', 'status must be a single string'],
      ['/evolutions', 'evaluation_id=0', 'evaluation_id must be a positive BIGINT decimal string'],
      ['/evolutions', 'evaluation_id=9223372036854775808', 'evaluation_id must be a positive BIGINT decimal string'],
      ['/evolutions', 'evaluation_id=1.2', 'evaluation_id must be a positive BIGINT decimal string'],
      ['/evolutions', 'evaluation_id=1&evaluation_id=2', 'evaluation_id must be a single string'],
      ['/evolutions', 'evaluation_id%5Bvalue%5D=1', 'evaluation_id must be a single string'],
    ]) {
      const response = await fetch(`${base}${endpoint}?patient_id=${patient}&${query}`, { headers });
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } }, query);
    }
    const denied = await fetch(`${base}/evaluations?patient_id=${patient}&status=draft`, { headers: { 'x-role': 'estudiante', 'x-permissions': 'other' } });
    assert.equal(denied.status, 403);
    const missingPatient = await fetch(`${base}/evolutions?status=draft`, { headers });
    assert.equal(missingPatient.status, 400);
  });
  assert.equal(d.calls.length, 6);
});
