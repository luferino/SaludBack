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
const declaration = (overrides = {}) => ({ id: '1', draft_id: '1', signer: 'parent', signer_name: 'Ana Pérez',
  signer_document: '12345678', declared_by: user, declared_at: '2026-11-18T10:00:00.000Z', ...overrides });
const patientDeclaration = declaration({ id: '2', signer: 'patient', signer_name: 'Luis Gómez',
  signer_document: '1234567', declared_at: '2026-11-18T11:00:00.000Z' });

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
  async declareConsent() { calls.count++; }, async consentHistory() { calls.count++; },
});
// Every rejected request must answer the same exact error and must never reach the repository.
async function assertRejected(response, status, code, message, calls) {
  assert.equal(response.status, status, message);
  assert.deepEqual(await response.json(), { error: { code, message } });
  assert.equal(calls.count, 0, `repository must not be reached for: ${message}`);
}
const parentBody = (overrides = {}) => ({ paper_signed: true, signer: 'parent', signer_name: 'Ana Pérez',
  signer_document: '12345678', ...overrides });
const PARENT_NAME = 'signer_name must be non-empty text of at most 200 characters without NUL';
const DOCUMENT = 'signer_document must be 4-8 digits';

test('S7: the student author declares a parent signature; the repository gets the exact input and actor', async () => {
  const received = [];
  const repository = { async declareConsent(draftId, input, actor) { received.push({ draftId, input, actor }); return declaration(); } };
  await serve(repository, async base => {
    const response = await send(`${base}/1/consent`, 'POST', parentBody());
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), declaration());
    assert.deepEqual(received, [{ draftId: '1', input: { signer: 'parent', signerName: 'Ana Pérez',
      signerDocument: '12345678' }, actor: { id: user, role: 'estudiante' } }]);
  });
});

test('S7: a patient signer sends no name or document; the repository gets null signer fields to copy from the patient', async () => {
  const received = [];
  const repository = { async declareConsent(draftId, input, actor) { received.push({ draftId, input, actor }); return patientDeclaration; } };
  await serve(repository, async base => {
    const response = await send(`${base}/1/consent`, 'POST', { paper_signed: true, signer: 'patient' });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), patientDeclaration);
    assert.deepEqual(received, [{ draftId: '1', input: { signer: 'patient', signerName: null, signerDocument: null },
      actor: { id: user, role: 'estudiante' } }]);
  });
});

test('S7: GET returns the latest declaration as current and the history oldest first; no declaration answers null', async () => {
  const calls = [];
  const repository = { async consentHistory(draftId, actor) { calls.push({ draftId, actor });
    return { current_declaration_id: '2', declarations: [declaration(), patientDeclaration] }; } };
  await serve(repository, async base => {
    for (const [role, requestHeaders] of [['estudiante', headers], ['teacher', readHeaders('teacher')],
      ['admin', readHeaders('admin')]]) {
      const response = await send(`${base}/1/consent`, 'GET', undefined, requestHeaders);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { current_declaration_id: '2', declarations: [declaration(), patientDeclaration] });
      assert.equal(calls.at(-1).actor.role, role);
    }
  });
  const empty = { async consentHistory() { return { current_declaration_id: null, declarations: [] }; } };
  await serve(empty, async base => {
    const response = await send(`${base}/1/consent`, 'GET');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { current_declaration_id: null, declarations: [] });
  });
});

test('S7: paper_signed must be exactly true; the paper is attested, not an electronic signature', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const paperSigned of [undefined, false, 'true', 1, null]) {
      await assertRejected(await send(`${base}/1/consent`, 'POST', parentBody({ paper_signed: paperSigned })),
        400, 'BAD_REQUEST', 'paper_signed must be true', calls);
    }
    await assertRejected(await send(`${base}/1/consent`, 'POST', { signer: 'patient' }),
      400, 'BAD_REQUEST', 'paper_signed must be true', calls);
  });
});

test('S7: signer must be patient or parent', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const signer of [undefined, 'Patient', 'guardian', '', null, 1]) {
      await assertRejected(await send(`${base}/1/consent`, 'POST', { paper_signed: true, signer }),
        400, 'BAD_REQUEST', 'signer must be patient or parent', calls);
    }
  });
});

test('S7: parent signer_name is non-empty text of at most 200 characters without NUL or lone surrogate, stored as sent', async () => {
  const received = [];
  const repository = { async declareConsent(_draftId, input) { received.push(input.signerName); return declaration(); } };
  await serve(repository, async base => {
    const longest = '\u{1F9B7}'.repeat(200);
    const response = await send(`${base}/1/consent`, 'POST', parentBody({ signer_name: longest }));
    assert.equal(response.status, 201);
    assert.deepEqual(received, [longest], '200 characters are accepted and stored exactly as sent');
    received.length = 0;
    await send(`${base}/1/consent`, 'POST', parentBody({ signer_name: '  Ana  ' }));
    assert.deepEqual(received, ['  Ana  '], 'surrounding spaces are stored as sent');
  });
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const signerName of ['', '   \n', '\t', 'a\u0000b', 'broken \uD800 text', '\u{1F9B7}'.repeat(201),
      'x'.repeat(201), 5, null, undefined]) {
      await assertRejected(await send(`${base}/1/consent`, 'POST', parentBody({ signer_name: signerName })),
        400, 'BAD_REQUEST', PARENT_NAME, calls);
    }
  });
});

test('S7: parent signer_document is 4 to 8 ASCII digits, the same format as the patient documento', async () => {
  const received = [];
  const repository = { async declareConsent(_draftId, input) { received.push(input.signerDocument); return declaration(); } };
  await serve(repository, async base => {
    for (const document of ['1234', '12345678']) {
      assert.equal((await send(`${base}/1/consent`, 'POST', parentBody({ signer_document: document }))).status, 201);
    }
    assert.deepEqual(received, ['1234', '12345678']);
  });
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const document of [undefined, '', '123', '123456789', '12a4', '1234 ', ' 1234', '١٢٣٤', 1234, null]) {
      await assertRejected(await send(`${base}/1/consent`, 'POST', parentBody({ signer_document: document })),
        400, 'BAD_REQUEST', DOCUMENT, calls);
    }
  });
});

test('S7: a patient signer rejects any signer_name or signer_document it sends, even null', async () => {
  const calls = { count: 0 };
  const message = 'signer_name and signer_document are only accepted for a parent signer';
  await serve(countingRepository(calls), async base => {
    await assertRejected(await send(`${base}/1/consent`, 'POST', { paper_signed: true, signer: 'patient', signer_name: 'Luis Gómez' }),
      400, 'BAD_REQUEST', message, calls);
    await assertRejected(await send(`${base}/1/consent`, 'POST', { paper_signed: true, signer: 'patient', signer_document: '1234567' }),
      400, 'BAD_REQUEST', message, calls);
    await assertRejected(await send(`${base}/1/consent`, 'POST', { paper_signed: true, signer: 'patient', signer_name: null }),
      400, 'BAD_REQUEST', message, calls);
  });
});

test('S7: the create body accepts only paper_signed, signer, signer_name and signer_document', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    await assertRejected(await send(`${base}/1/consent`, 'POST', parentBody({ expected_version: '1' })),
      400, 'BAD_REQUEST', 'allowed fields: paper_signed, signer, signer_name, signer_document', calls);
    await assertRejected(await send(`${base}/1/consent`, 'POST', { paper_signed: true, signer: 'patient', declared_by: user }),
      400, 'BAD_REQUEST', 'allowed fields: paper_signed, signer, signer_name, signer_document', calls);
  });
});

test('S7: consent guards answer 401, then the write permission, then the student author role before any body check', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    const url = `${base}/1/consent`;
    await assertRejected(await send(url, 'POST', parentBody(), { 'content-type': 'application/json' }),
      401, 'UNAUTHORIZED', 'Authentication required', calls);
    await assertRejected(await send(url, 'POST', parentBody(), readHeaders('estudiante')),
      403, 'FORBIDDEN', "Permission 'hygiene-preventive-drafts:write' required", calls);
    await assertRejected(await send(url, 'POST', { paper_signed: false, signer: 'guardian' }, readHeaders('teacher')),
      403, 'FORBIDDEN', "Permission 'hygiene-preventive-drafts:write' required", calls);
    await assertRejected(await send(url, 'POST', parentBody(), { ...headers, 'x-role': 'teacher' }),
      403, 'FORBIDDEN', 'student author role required', calls);
    await assertRejected(await send(url, 'POST', parentBody(), { ...headers, 'x-role': 'admin' }),
      403, 'FORBIDDEN', 'student author role required', calls);
    await assertRejected(await send(url, 'POST', { paper_signed: false }, { ...headers, 'x-role': 'admin' }),
      403, 'FORBIDDEN', 'student author role required', calls);
    await assertRejected(await send(url, 'GET', undefined, { 'content-type': 'application/json' }),
      401, 'UNAUTHORIZED', 'Authentication required', calls);
    await assertRejected(await send(url, 'GET', undefined, { ...headers, 'x-permissions': 'oral-surgery-drafts:read' }),
      403, 'FORBIDDEN', "Permission 'hygiene-preventive-drafts:read' required", calls);
  });
});

test('S7: a malformed draft id and any GET query string are rejected before the repository', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    await assertRejected(await send(`${base}/abc/consent`, 'POST', parentBody()),
      400, 'BAD_REQUEST', 'draft id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(`${base}/0/consent`, 'GET'),
      400, 'BAD_REQUEST', 'draft id must be a positive BIGINT decimal string', calls);
    await assertRejected(await send(`${base}/1/consent?signer=patient`, 'GET'),
      400, 'BAD_REQUEST', 'query parameters are not supported', calls);
    await assertRejected(await send(`${base}/1/consent?limit=1`, 'GET', undefined, readHeaders('teacher')),
      400, 'BAD_REQUEST', 'query parameters are not supported', calls);
  });
});
