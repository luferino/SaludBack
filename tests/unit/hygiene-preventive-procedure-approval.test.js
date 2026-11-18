import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createHygienePreventiveDraftRouter } from '../../src/modules/hygiene-preventive-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const teacherUser = '10000000-0000-4000-8000-000000000009';
const approveHeaders = role => ({ 'content-type': 'application/json', 'x-role': role,
  'x-permissions': 'hygiene-preventive-drafts:approve' });
const teacherHeaders = approveHeaders('teacher');
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
const send = (url, method, body, requestHeaders = teacherHeaders) => fetch(url, {
  method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
});
const countingRepository = calls => ({
  async approveProcedure() { calls.count++; },
});
// Every rejected request must answer the same exact error and must never reach the repository.
async function assertRejected(response, status, code, message, calls) {
  assert.equal(response.status, status, message);
  assert.deepEqual(await response.json(), { error: { code, message } });
  assert.equal(calls.count, 0, `repository must not be reached for: ${message}`);
}
const approvalUrl = (base, draftId = '1', procedureId = '7') => `${base}/${draftId}/procedures/${procedureId}/approval`;
const BAD_VERSION = 'expected_version must be a positive BIGINT decimal string';

test('S5: a teacher approves a pending entry with its expected version; the response is the approved entry', async () => {
  const received = [];
  const approved = entry({ version: '2', approved_by: teacherUser, teacher_name: 'Luis Gómez',
    approved_at: '2026-11-18T11:00:00.000Z' });
  const repository = { async approveProcedure(draftId, procedureId, version, actor) {
    received.push({ draftId, procedureId, version, actor });
    return approved; } };
  await serve(repository, async base => {
    const response = await send(approvalUrl(base), 'POST', { expected_version: '1' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...approved, status: 'approved' });
    assert.deepEqual(received, [{ draftId: '1', procedureId: '7', version: '1',
      actor: { id: teacherUser, role: 'teacher' } }]);
  });
});

test('S5: the approval body is exactly expected_version as a positive BIGINT decimal string', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const body of [{}, { expected_version: 1 }, { expected_version: '0' }, { expected_version: '01' },
      { expected_version: '' }, { expected_version: ' 1' }, { expected_version: '9223372036854775808' },
      { expected_version: null }]) {
      await assertRejected(await send(approvalUrl(base), 'POST', body), 400, 'BAD_REQUEST', BAD_VERSION, calls);
    }
    for (const body of [{ expected_version: '1', approved_by: user }, { expected_version: '1', teacher_name: 'Otro' },
      { expected_version: '1', approved_at: '2026-11-18T11:00:00.000Z' }]) {
      await assertRejected(await send(approvalUrl(base), 'POST', body), 400, 'BAD_REQUEST',
        'allowed fields: expected_version', calls);
    }
  });
  assert.equal(calls.count, 0);
});

test('S5: malformed draft and procedure ids are rejected before the repository', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    const body = { expected_version: '1' };
    await assertRejected(await send(approvalUrl(base, 'abc', '7'), 'POST', body),
      400, 'BAD_REQUEST', 'draft id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(approvalUrl(base, '0', '7'), 'POST', body),
      400, 'BAD_REQUEST', 'draft id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(approvalUrl(base, '1', 'x'), 'POST', body),
      400, 'BAD_REQUEST', 'procedure id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(approvalUrl(base, '1', '9223372036854775808'), 'POST', body),
      400, 'BAD_REQUEST', 'procedure id must be a positive BIGINT decimal string', calls);
  });
  assert.equal(calls.count, 0);
});

test('S5: guard order is 401, then the approve permission, then the teacher role; rejected requests never reach the repository', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    const body = { expected_version: '1' };
    // 401: no verified caller, with or without the approve permission in the request.
    await assertRejected(await send(approvalUrl(base), 'POST', body, { 'content-type': 'application/json' }),
      401, 'UNAUTHORIZED', 'Authentication required', calls);
    // 403 permission: a teacher without the approve permission, and a student or admin without it.
    await assertRejected(await send(approvalUrl(base), 'POST', body, { ...teacherHeaders,
      'x-permissions': 'hygiene-preventive-drafts:read,hygiene-preventive-drafts:write' }),
    403, 'FORBIDDEN', "Permission 'hygiene-preventive-drafts:approve' required", calls);
    await assertRejected(await send(approvalUrl(base), 'POST', body, { ...approveHeaders('estudiante'),
      'x-permissions': 'hygiene-preventive-drafts:read,hygiene-preventive-drafts:write' }),
    403, 'FORBIDDEN', "Permission 'hygiene-preventive-drafts:approve' required", calls);
    await assertRejected(await send(approvalUrl(base), 'POST', body, { ...approveHeaders('admin'),
      'x-permissions': 'hygiene-preventive-drafts:read' }),
    403, 'FORBIDDEN', "Permission 'hygiene-preventive-drafts:approve' required", calls);
    // 403 role: the approve permission alone is not enough; admins and students never approve.
    await assertRejected(await send(approvalUrl(base), 'POST', body, approveHeaders('admin')),
      403, 'FORBIDDEN', 'teacher instructor role required', calls);
    await assertRejected(await send(approvalUrl(base), 'POST', body, approveHeaders('estudiante')),
      403, 'FORBIDDEN', 'teacher instructor role required', calls);
  });
  assert.equal(calls.count, 0);
});
