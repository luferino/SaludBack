import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createOralSurgeryDraftRouter } from '../../src/modules/oral-surgery-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const headers = { 'content-type': 'application/json', 'x-role': 'estudiante',
  'x-permissions': 'oral-surgery-drafts:read,oral-surgery-drafts:write' };
async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: user, role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/oral-surgery-drafts', createOralSurgeryDraftRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/oral-surgery-drafts/1/consent`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('S2/S3: paper declaration records the authenticated author and time, never a patient digital signature', async () => {
  const declarations = [];
  const repository = {
    async declareConsent(id, version, actor) {
      assert.equal(id, '1'); assert.equal(version, '7'); assert.deepEqual(actor, { id: user, role: 'estudiante' });
      const row = { id: '1', draft_id: id, draft_version: version, plan_revision: '2',
        treatment_plan: { procedure: 'Extraction' }, declared_by: actor.id, declared_at: '2026-11-06T10:00:00.000Z' };
      declarations.push(row); return row;
    },
    async consentHistory(id, actor) {
      assert.equal(id, '1'); assert.equal(actor.id, user);
      return { draft_version: '7', plan_revision: '2', current_declaration_id: '1', declarations };
    },
  };
  await serve(repository, async url => {
    const response = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ expected_version: '7', paper_signed: true }) });
    assert.equal(response.status, 201);
    const declaration = await response.json();
    assert.equal(declaration.declared_by, user); assert.equal(declaration.draft_version, '7');
    assert.equal(declaration.declared_at, '2026-11-06T10:00:00.000Z');
    const read = await fetch(url, { headers }); assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { draft_version: '7', plan_revision: '2', current_declaration_id: '1', declarations: [declaration] });
  });
});

test('S2/S3: consent requires explicit true, exact version and student write permission; rejection changes no counters', async () => {
  let calls = 0;
  await serve({ async declareConsent() { calls++; } }, async url => {
    for (const paper_signed of [false, null, 'true', 1, undefined]) {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ expected_version: '1', paper_signed }) });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
    for (const body of [{ paper_signed: true }, { expected_version: '0', paper_signed: true },
      { expected_version: '1', paper_signed: true, declared_by: user }]) {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
    for (const role of ['teacher', 'admin']) {
      const response = await fetch(url, { method: 'POST', headers: { ...headers, 'x-role': role }, body: '{}' });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: 'student author role required' } });
    }
    const denied = await fetch(url, { method: 'POST', headers: { ...headers, 'x-permissions': 'oral-surgery-drafts:read' }, body: '{}' });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: { code: 'FORBIDDEN', message: "Permission 'oral-surgery-drafts:write' required" } });
    const anonymous = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  });
  assert.equal(calls, 0);
});
