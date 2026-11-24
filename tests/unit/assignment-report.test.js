import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createAssignmentReportRouter } from '../../src/modules/assignment-report/routes.ts';
import { PgAssignmentReportRepository } from '../../src/modules/assignment-report/repository.ts';

const row = { career: 'odontology', subject_id: 'subject', academic_group_id: 'group', assignment_count: 2 };
const dates = '?from=2026-11-01&to=2026-11-01';

async function serve(run) {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = {
      role: req.headers['x-role'], permissions: req.headers['x-allow'] ? ['assignment-reports:read'] : [],
    };
    next();
  });
  app.use('/reports/assignments', createAssignmentReportRouter(new PgAssignmentReportRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: params[0] === '2026-11-01' ? [{ ...row, patient_id: 'not public' }] : [] };
    },
  })));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: { code: error.code, message: error.message } }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const get = (query = dates, role = 'admin', allow = true) => fetch(
    `http://127.0.0.1:${server.address().port}/reports/assignments${query}`,
    { headers: { ...(role && { 'x-role': role }), ...(allow && { 'x-allow': '1' }) } },
  );
  try { await run(get, calls); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}

test('historical report returns only totals and academic dimensions and queries inclusive Paraguay dates', () => serve(async (get, calls) => {
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { total: 2, items: [row] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['2026-11-01', '2026-11-01', 'America/Asuncion']);
  assert.match(calls[0].sql, /assigned_at\s*>=.*AT TIME ZONE \$3/);
  assert.match(calls[0].sql, /assigned_at\s*<.*\$2::date \+ 1.*AT TIME ZONE \$3/);
  assert.match(calls[0].sql, /h\.id = a\.student_habilitation_id/);
  assert.match(calls[0].sql, /GROUP BY c\.code, a\.subject_id, h\.academic_group_id/);
  assert.doesNotMatch(calls[0].sql, /ended_at|revoked_at|DISTINCT|patient_id/i);
  const empty = await get('?from=2026-11-02&to=2026-11-02');
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { total: 0, items: [] });
}));

test('requires both active admin role and report permission before reading the database', () => serve(async (get, calls) => {
  for (const [role, allow, status] of [['', false, 401], ['teacher', true, 403], ['reception', true, 403], ['admin', false, 403]]) {
    const response = await get(dates, role, allow);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
  }
  assert.deepEqual(calls, []);
}));

test('rejects invalid, reversed, repeated, oversized and unsupported date queries before any read', () => serve(async (get, calls) => {
  for (const [query, message] of [
    ['', 'from must be a valid YYYY-MM-DD date'],
    ['?from=2026-02-29&to=2026-03-01', 'from must be a valid YYYY-MM-DD date'],
    ['?from=2026-11-02&to=2026-11-01', 'from must be on or before to'],
    ['?from=2025-01-01&to=2026-01-02', 'date range must not exceed 366 days'],
    [`${dates}&to=2026-11-02`, 'query parameter must not be repeated: to'],
    [`${dates}&patient_id=anything`, 'unknown query parameter'],
  ]) {
    const response = await get(query);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
  }
  assert.deepEqual(calls, []);
}));
