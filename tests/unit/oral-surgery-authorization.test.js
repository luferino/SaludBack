import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createOralSurgeryDraftRouter } from '../../src/modules/oral-surgery-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const headers = { 'content-type': 'application/json', 'x-role': 'teacher',
  'x-permissions': 'oral-surgery-drafts:read,oral-surgery-drafts:authorize' };
async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: user, role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/oral-surgery-drafts', createOralSurgeryDraftRouter({ repository })); app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/oral-surgery-drafts/1/authorizations`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const body = { expected_version: '7', consent_declaration_id: '2', paper_consent_verified: true };

test('S3/S4: teacher verification records an authorization with reviewed version, content and consent reference', async () => {
  let saved;
  await serve({
    async authorizeSurgery(id, version, consentId, actor) {
      assert.equal(id, '1'); assert.equal(version, '7'); assert.equal(consentId, '2');
      assert.deepEqual(actor, { id: user, role: 'teacher' });
      saved = { id: '3', draft_id: id, draft_version: version, consent_declaration_id: consentId,
        reviewed_content: { treatment_plan: { procedure: 'Extraction' } }, authorized_by: actor.id,
        teacher_habilitation_id: '10000000-0000-4000-8000-000000000002', authorized_at: '2026-11-06T10:00:00.000Z' };
      return saved;
    },
    async authorizationHistory(id, actor) {
      assert.equal(id, '1'); assert.equal(actor.id, user);
      return { draft_version: '7', current_authorization_id: saved.id, authorizations: [saved] };
    },
  }, async url => {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 201); assert.deepEqual(await response.json(), saved);
    const read = await fetch(url, { headers }); assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { draft_version: '7', current_authorization_id: '3', authorizations: [saved] });
  });
});

test('S3/S4: authorizing requires teacher role, separate permission and literal paper verification; invalid input never writes', async () => {
  let calls = 0;
  await serve({ async authorizeSurgery() { calls++; } }, async url => {
    for (const value of [false, null, 'true', 1, undefined]) {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, paper_consent_verified: value }) });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
    for (const invalid of [{ ...body, expected_version: '0' }, { ...body, consent_declaration_id: 'bad' },
      { ...body, authorized_by: user }, { paper_consent_verified: true, expected_version: '1' }]) {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(invalid) });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
    for (const role of ['estudiante', 'admin']) {
      const response = await fetch(url, { method: 'POST', headers: { ...headers, 'x-role': role }, body: '{}' });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: 'teacher instructor role required' } });
    }
    const denied = await fetch(url, { method: 'POST', headers: { ...headers, 'x-permissions': 'oral-surgery-drafts:read' }, body: '{}' });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: { code: 'FORBIDDEN', message: "Permission 'oral-surgery-drafts:authorize' required" } });
    const anonymous = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  });
  assert.equal(calls, 0);
});
