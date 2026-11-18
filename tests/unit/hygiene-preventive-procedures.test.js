import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createHygienePreventiveDraftRouter } from '../../src/modules/hygiene-preventive-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const teacherUser = '10000000-0000-4000-8000-000000000009';
const headers = { 'content-type': 'application/json', 'x-role': 'estudiante',
  'x-permissions': 'hygiene-preventive-drafts:read,hygiene-preventive-drafts:write' };
const readHeaders = role => ({ 'content-type': 'application/json', 'x-role': role,
  'x-permissions': 'hygiene-preventive-drafts:read' });
const entry = (overrides = {}) => ({ id: '7', draft_id: '1', procedure_date: '2026-11-17',
  description: 'Profilaxis y topicación con flúor', author_id: user, student_name: 'Ana Pérez', version: '1',
  approved_by: null, teacher_name: null, approved_at: null,
  created_at: '2026-11-18T10:00:00.000Z', updated_at: '2026-11-18T10:00:00.000Z', ...overrides });

async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: req.headers['x-role'] === 'teacher' ? teacherUser : user,
      role: req.headers['x-role'], permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/hygiene-preventive-drafts', createHygienePreventiveDraftRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/hygiene-preventive-drafts`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const send = (url, method, body, requestHeaders = headers) => fetch(url, {
  method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
});
const countingRepository = calls => ({
  async listProcedures() { calls.count++; return []; }, async addProcedure() { calls.count++; },
  async editProcedure() { calls.count++; }, async deleteProcedure() { calls.count++; },
});
// Every rejected request must answer the same exact error and must never reach the repository.
async function assertRejected(response, status, code, message, calls) {
  assert.equal(response.status, status, message);
  assert.deepEqual(await response.json(), { error: { code, message } });
  assert.equal(calls.count, 0, `repository must not be reached for: ${message}`);
}
const isoDay = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test('S6: the student author adds a procedure entry with its date and free text; the response is a pending entry', async () => {
  const received = [];
  const repository = { async addProcedure(draftId, input, actor) { received.push({ draftId, input, actor });
    return entry({ procedure_date: input.procedureDate, description: input.description }); } };
  await serve(repository, async base => {
    const response = await send(`${base}/1/procedures`, 'POST',
      { procedure_date: '2026-11-17', description: 'Profilaxis y topicación con flúor' });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ...entry(), status: 'pending' });
    assert.deepEqual(received, [{ draftId: '1', input: { procedureDate: '2026-11-17',
      description: 'Profilaxis y topicación con flúor' }, actor: { id: user, role: 'estudiante' } }]);
  });
});

test('S6: the procedure date is a real YYYY-MM-DD date that is not in the future; today is accepted', async () => {
  const received = [];
  const repository = { async addProcedure(_draftId, input) { received.push(input.procedureDate);
    return entry({ procedure_date: input.procedureDate }); } };
  await serve(repository, async base => {
    const today = isoDay(0);
    const response = await send(`${base}/1/procedures`, 'POST', { procedure_date: today, description: 'Sellantes' });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).procedure_date, today);
    assert.deepEqual(received, [today]);
  });
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const [date, message] of [
      [isoDay(1), 'procedure_date cannot be in the future'],
      ['2026-02-30', 'procedure_date must be a valid YYYY-MM-DD date'],
      ['2026-13-01', 'procedure_date must be a valid YYYY-MM-DD date'],
      ['0000-01-01', 'procedure_date must be a valid YYYY-MM-DD date'],
      ['17/11/2026', 'procedure_date must be a valid YYYY-MM-DD date'],
      ['2026-11-17T10:00:00Z', 'procedure_date must be a valid YYYY-MM-DD date'],
      [20261117, 'procedure_date must be a valid YYYY-MM-DD date'],
      [null, 'procedure_date must be a valid YYYY-MM-DD date'],
      [undefined, 'procedure_date must be a valid YYYY-MM-DD date'],
    ]) {
      await assertRejected(await send(`${base}/1/procedures`, 'POST', { procedure_date: date, description: 'x' }),
        400, 'BAD_REQUEST', message, calls);
    }
  });
});

test('S6: the procedure is free text of 1 to 1000 characters without NUL', async () => {
  const received = [];
  const repository = { async addProcedure(_draftId, input) { received.push(input.description); return entry(); } };
  await serve(repository, async base => {
    const longest = '\u{1F9B7}'.repeat(1000);
    const response = await send(`${base}/1/procedures`, 'POST', { procedure_date: '2026-11-17', description: longest });
    assert.equal(response.status, 201);
    assert.deepEqual(received, [longest], 'stored exactly as sent');
  });
  const calls = { count: 0 };
  const message = 'description must be non-empty text of at most 1000 characters without NUL';
  await serve(countingRepository(calls), async base => {
    for (const description of ['', '   \n', 'x'.repeat(1001), 'a\u0000b', 'broken \uD800 text', 5, null, undefined]) {
      await assertRejected(await send(`${base}/1/procedures`, 'POST', { procedure_date: '2026-11-17', description }),
        400, 'BAD_REQUEST', message, calls);
    }
  });
});

test('S6: entries list in draft order with their status; teachers and admins read them', async () => {
  const calls = [];
  const items = [entry(), entry({ id: '8', version: '2', approved_by: teacherUser, teacher_name: 'Luis Gómez',
    approved_at: '2026-11-18T11:00:00.000Z' })];
  const repository = { async listProcedures(draftId, actor) { calls.push({ draftId, actor }); return items; } };
  await serve(repository, async base => {
    for (const [role, requestHeaders] of [['estudiante', headers], ['teacher', readHeaders('teacher')],
      ['admin', readHeaders('admin')]]) {
      const response = await send(`${base}/1/procedures`, 'GET', undefined, requestHeaders);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { items: [{ ...items[0], status: 'pending' },
        { ...items[1], status: 'approved' }] });
      assert.equal(calls.at(-1).actor.role, role);
    }
  });
});

test('S6: the author edits a pending entry with its expected version and both fields', async () => {
  const received = [];
  const repository = { async editProcedure(draftId, procedureId, version, input, actor) {
    received.push({ draftId, procedureId, version, input, actor });
    return entry({ version: '2', description: input.description }); } };
  await serve(repository, async base => {
    const response = await send(`${base}/1/procedures/7`, 'PATCH',
      { expected_version: '1', procedure_date: '2026-11-16', description: 'Control de placa' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...entry({ version: '2', description: 'Control de placa' }), status: 'pending' });
    assert.deepEqual(received, [{ draftId: '1', procedureId: '7', version: '1',
      input: { procedureDate: '2026-11-16', description: 'Control de placa' }, actor: { id: user, role: 'estudiante' } }]);
  });
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const [body, message] of [
      [{ procedure_date: '2026-11-16', description: 'x' }, 'expected_version must be a positive BIGINT decimal string'],
      [{ expected_version: 1, procedure_date: '2026-11-16', description: 'x' }, 'expected_version must be a positive BIGINT decimal string'],
      [{ expected_version: '1', description: 'x' }, 'procedure_date must be a valid YYYY-MM-DD date'],
      [{ expected_version: '1', procedure_date: '2026-11-16' }, 'description must be non-empty text of at most 1000 characters without NUL'],
      [{ expected_version: '1', procedure_date: '2026-11-16', description: 'x', approved_by: user },
        'allowed fields: expected_version, procedure_date, description'],
    ]) await assertRejected(await send(`${base}/1/procedures/7`, 'PATCH', body), 400, 'BAD_REQUEST', message, calls);
  });
});

test('S6: the author deletes a pending entry with its expected version in the query', async () => {
  const received = [];
  const repository = { async deleteProcedure(draftId, procedureId, version, actor) {
    received.push({ draftId, procedureId, version, actor }); } };
  await serve(repository, async base => {
    const response = await send(`${base}/1/procedures/7?expected_version=3`, 'DELETE');
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.deepEqual(received, [{ draftId: '1', procedureId: '7', version: '3', actor: { id: user, role: 'estudiante' } }]);
  });
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const [query, message] of [
      ['', 'expected_version must be a positive BIGINT decimal string'],
      ['?expected_version=0', 'expected_version must be a positive BIGINT decimal string'],
      ['?expected_version=1&force=true', 'allowed fields: expected_version'],
    ]) await assertRejected(await send(`${base}/1/procedures/7${query}`, 'DELETE'), 400, 'BAD_REQUEST', message, calls);
  });
});

test('S6: unknown create fields, malformed ids and wrong permissions or roles are rejected before the repository', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    const body = { procedure_date: '2026-11-17', description: 'x' };
    await assertRejected(await send(`${base}/1/procedures`, 'POST', { ...body, student_name: 'Otro' }),
      400, 'BAD_REQUEST', 'allowed fields: procedure_date, description', calls);
    await assertRejected(await send(`${base}/abc/procedures`, 'POST', body),
      400, 'BAD_REQUEST', 'draft id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(`${base}/0/procedures`, 'GET'),
      400, 'BAD_REQUEST', 'draft id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(`${base}/1/procedures/x`, 'PATCH', { ...body, expected_version: '1' }),
      400, 'BAD_REQUEST', 'procedure id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(`${base}/1/procedures/9223372036854775808?expected_version=1`, 'DELETE'),
      400, 'BAD_REQUEST', 'procedure id must be a positive BIGINT decimal string', calls);
    for (const [method, url] of [['POST', `${base}/1/procedures`], ['PATCH', `${base}/1/procedures/7`],
      ['DELETE', `${base}/1/procedures/7?expected_version=1`]]) {
      const payload = method === 'DELETE' ? undefined : { ...body, expected_version: '1' };
      await assertRejected(await send(url, method, payload, readHeaders('teacher')), 403, 'FORBIDDEN',
        "Permission 'hygiene-preventive-drafts:write' required", calls);
      await assertRejected(await send(url, method, payload, { ...headers, 'x-role': 'teacher' }), 403, 'FORBIDDEN',
        'student author role required', calls);
      await assertRejected(await send(url, method, payload, { 'content-type': 'application/json' }), 401, 'UNAUTHORIZED',
        'Authentication required', calls);
    }
    await assertRejected(await send(`${base}/1/procedures`, 'GET', undefined, { ...headers, 'x-permissions': 'oral-surgery-drafts:read' }),
      403, 'FORBIDDEN', "Permission 'hygiene-preventive-drafts:read' required", calls);
    await assertRejected(await send(`${base}/1/procedures?status=pending`, 'GET'),
      400, 'BAD_REQUEST', 'query parameters are not supported', calls);
  });
  assert.equal(calls.count, 0);
});
