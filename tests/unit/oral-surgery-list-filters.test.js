import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createOralSurgeryDraftRouter } from '../../src/modules/oral-surgery-drafts/index.ts';
import { PgOralSurgeryDraftRepository } from '../../src/modules/oral-surgery-drafts/infrastructure/pg-oral-surgery-draft.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const patient = '10000000-0000-4000-8000-000000000002';
const headers = { 'x-role': 'estudiante', 'x-permissions': 'oral-surgery-drafts:read' };
async function serve(repository, run) {
  const app = express();
  app.use((req, _res, next) => { req.auth = { userId: user, role: req.headers['x-role'],
    permissions: String(req.headers['x-permissions'] ?? '').split(',') }; next(); });
  app.use('/oral-surgery-drafts', createOralSurgeryDraftRouter({ repository })); app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/oral-surgery-drafts`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function db() {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  return { repository: new PgOralSurgeryDraftRepository({}, pool), calls };
}

test('S8/S14/S15: date range reaches SQL on created_at in UTC while preserving scope, patient and pagination', async () => {
  const { repository, calls } = db();
  await serve(repository, async base => {
    const response = await fetch(`${base}?patient_id=${patient}&date_from=2024-02-29&date_to=2024-03-01&limit=7&offset=11`, { headers });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { items: [] });
  });
  const query = calls[0];
  assert.deepEqual(query.params, [patient, user, 'estudiante', null, null, 7, 11, '2024-02-29', '2024-03-01']);
  assert.match(query.sql, /e\.created_at\s*>=.*UTC/is);
  assert.match(query.sql, /e\.created_at\s*</);
  assert.match(query.sql, /\$3 = 'admin'/); assert.match(query.sql, /e\.author_id = \$2/);
  assert.match(query.sql, /sp\.revoked_at IS NULL/); assert.match(query.sql, /a\.ended_at IS NULL/);
  assert.match(query.sql, /th\.academic_group_id = e\.origin_group_id/);
  assert.match(query.sql, /ORDER BY e\.id DESC LIMIT \$6 OFFSET \$7/);
  assert.doesNotMatch(query.sql, /e\.status\s*=/);
});

test('S8/S15: each date endpoint is independently optional', async () => {
  for (const [queryString, expected] of [
    ['?date_from=2024-02-29', [null, user, 'estudiante', null, null, 50, 0, '2024-02-29', null]],
    ['?date_to=2024-03-01', [null, user, 'estudiante', null, null, 50, 0, null, '2024-03-01']],
  ]) {
    const { repository, calls } = db();
    await serve(repository, async base => {
      const response = await fetch(`${base}${queryString}`, { headers }); assert.equal(response.status, 200);
    });
    assert.deepEqual(calls[0].params, expected);
  }
});

test('S8/S15: omitted dates keep existing list scope and defaults unchanged', async () => {
  const { repository, calls } = db();
  await serve(repository, async base => {
    const response = await fetch(`${base}?patient_id=${patient}`, { headers }); assert.equal(response.status, 200);
  });
  assert.deepEqual(calls[0].params, [patient, user, 'estudiante', null, null, 50, 0, null, null]);
});

test('S8/S15: malformed, duplicate, structured, invalid calendar or reversed dates reject before repository access', async () => {
  let calls = 0;
  const repository = { async list() { calls++; return []; } };
  await serve(repository, async base => {
    const invalid = [
      '?date_from=2024-02-30', '?date_to=2023-02-29', '?date_from=2024-1-01',
      '?date_from=2024-01-01T00%3A00%3A00Z', '?date_from=', '?date_from=2024-01-01&date_from=2024-01-02',
      '?date_to=2024-01-01&date_to=2024-01-02', '?date_from=2024-01-01%26date_from%3D2024-01-02',
      '?date_from%5Bstart%5D=2024-01-01', '?date_from=2024-02-02&date_to=2024-02-01',
      '?status=draft', '?foo=bar',
    ];
    for (const query of invalid) {
      const response = await fetch(`${base}${query}`, { headers }); assert.equal(response.status, 400, query);
    }
    for (const role of ['admin', 'teacher', 'estudiante']) {
      const denied = await fetch(`${base}?date_from=2024-01-01`, { headers: { 'x-role': role, 'x-permissions': 'other' } });
      assert.equal(denied.status, 403);
    }
  });
  assert.equal(calls, 0);
});
