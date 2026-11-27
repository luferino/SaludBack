import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createEndodonticsDraftRouter } from '../../src/modules/endodontics-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';

const author = '10000000-0000-4000-8000-000000000001';
const otherStudent = '10000000-0000-4000-8000-000000000009';
const teacher = '10000000-0000-4000-8000-000000000007';
const admin = '10000000-0000-4000-8000-000000000008';
const READ = 'endodontics-drafts:read';
const WRITE = 'endodontics-drafts:write';
const CLOSE = 'endodontics-treatment-reports:close';
const content = { treated_teeth: ['16'], diagnosis: 'diagnóstico libre', session_count: 2,
  canal_measurements: [{ tooth: '16', canal: 'MV', obturation_cut: { option: 'canal_entry', apex_mm: null } }] };

// Fake store with the repository's rules: author-only writes, one report per draft, stale and closed refusals,
// teacher-only close, and draft edits refused once the report is closed. `writes` counts persisted changes.
function fakeStore() {
  const state = { draft: { id: '22', author_id: author, content: {}, version: '1' }, report: null, writes: 0 };
  const visibleTo = (actor) => actor.role === 'admin' || actor.id === state.draft.author_id || actor.role === 'teacher';
  const repo = {
    async get(id, actor) { if (!visibleTo(actor)) throw new NotFoundError('endodontics draft was not found'); return state.draft; },
    async list() { return [state.draft]; },
    async create() { throw new Error('not used'); },
    async edit(id, version, next, actor) {
      if (actor.id !== state.draft.author_id) throw new NotFoundError('endodontics draft was not found');
      if (state.report?.status === 'closed') throw new ConflictError('endodontics draft is locked by a closed treatment report');
      if (state.draft.version !== version) throw new ConflictError('draft version changed; reload before saving');
      state.draft = { ...state.draft, content: next, version: String(Number(version) + 1) }; state.writes += 1; return state.draft;
    },
    async createTreatmentReport(draftId, next, actor) {
      if (actor.id !== state.draft.author_id) throw new NotFoundError('endodontics draft was not found');
      if (state.report) throw new ConflictError('treatment report already exists; reload before saving');
      state.report = { draft_id: draftId, content: next, version: '1', status: 'draft', created_by: actor.id,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', closed_by: null, closed_at: null, teacher_habilitation_id: null };
      state.writes += 1; return state.report;
    },
    async getTreatmentReport(draftId, actor) {
      if (!visibleTo(actor) || !state.report) throw new NotFoundError('endodontics treatment report was not found');
      return state.report;
    },
    async editTreatmentReport(draftId, version, next, actor) {
      if (actor.id !== state.draft.author_id || !state.report) throw new NotFoundError('endodontics treatment report was not found');
      if (state.report.version !== version || state.report.status !== 'draft') throw new ConflictError('treatment report changed or is closed; reload before saving');
      state.report = { ...state.report, content: next, version: String(Number(version) + 1) }; state.writes += 1; return state.report;
    },
    async closeTreatmentReport(draftId, version, draftVersion, actor) {
      if (actor.role !== 'teacher') throw new ForbiddenError('teacher instructor role required');
      if (!state.report) throw new NotFoundError('endodontics treatment report was not found');
      if (state.draft.version !== draftVersion) throw new ConflictError('draft version changed; reload before saving');
      if (state.report.version !== version || state.report.status !== 'draft') throw new ConflictError('treatment report changed or is closed; reload before saving');
      state.report = { ...state.report, status: 'closed', version: String(Number(version) + 1), closed_by: actor.id,
        closed_at: '2026-01-02T00:00:00.000Z', teacher_habilitation_id: 'teacher-period' };
      state.writes += 1; return state.report;
    },
  };
  return { state, repo };
}

async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: String(req.headers['x-user'] ?? author), role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/endodontics-drafts', createEndodonticsDraftRouter({ repository })); app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/endodontics-drafts/22/treatment-report`;
  const call = async (method, { role = 'estudiante', user = author, permissions = `${READ},${WRITE}`, body, path = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-role': role,
      'x-user': user, 'x-permissions': permissions }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  try { await run(call, server); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('S1/S3: the student author creates the report through the draft context and it starts open at version 1', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    const created = await call('POST', { body: { content } });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'draft'); assert.equal(created.body.version, '1');
    assert.deepEqual(created.body.content, content);
    assert.equal(state.writes, 1);
  });
});

test('S2: one report per draft; a second create is refused with 409 and changes nothing', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    const duplicate = await call('POST', { body: { content: { diagnosis: 'otro' } } });
    assert.equal(duplicate.status, 409); assert.equal(duplicate.body.error.code, 'CONFLICT');
  });
  assert.equal(state.writes, 1); assert.deepEqual(state.report.content, content);
});

test('S3 boundary: teachers and admins cannot create or edit reports; students without write permission cannot either', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    for (const role of ['teacher', 'admin']) {
      assert.equal((await call('POST', { role, user: role === 'teacher' ? teacher : admin, permissions: `${READ},${WRITE},${CLOSE}`, body: { content } })).status, 403);
    }
    assert.equal((await call('POST', { permissions: READ, body: { content } })).status, 403);
    assert.equal(state.report, null);
    await call('POST', { body: { content } });
    assert.equal((await call('PATCH', { role: 'teacher', user: teacher, permissions: `${READ},${WRITE}`, body: { expected_version: '1', content } })).status, 403);
    assert.equal((await call('PATCH', { user: otherStudent, body: { expected_version: '1', content } })).status, 404);
  });
  assert.equal(state.writes, 1);
});

test('S3 boundary: reads follow draft read scope; cross-context and missing reports are not disclosed', async () => {
  const { repo } = fakeStore();
  await serve(repo, async call => {
    assert.equal((await call('GET')).status, 404);
    await call('POST', { body: { content } });
    assert.equal((await call('GET')).status, 200);
    assert.equal((await call('GET', { role: 'teacher', user: teacher, permissions: READ })).status, 200);
    assert.equal((await call('GET', { role: 'admin', user: admin, permissions: READ })).status, 200);
    assert.equal((await call('GET', { user: otherStudent, permissions: READ })).status, 404);
    assert.equal((await call('GET', { permissions: '' })).status, 403);
  });
});

test('S2/S3 edits: PATCH replaces content only with the current expected_version; stale is 409 and leaves storage unchanged', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    const next = { diagnosis: 'revisado' };
    const updated = await call('PATCH', { body: { expected_version: '1', content: next } });
    assert.equal(updated.status, 200); assert.equal(updated.body.version, '2'); assert.deepEqual(updated.body.content, next);
    const stale = await call('PATCH', { body: { expected_version: '1', content: { diagnosis: 'stale' } } });
    assert.equal(stale.status, 409);
  });
  assert.equal(state.writes, 2); assert.deepEqual(state.report.content, { diagnosis: 'revisado' });
});

test('S3 close: only the in-context teacher with the close permission can close; the report is then closed with audit fields', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    const closed = await call('POST', { role: 'teacher', user: teacher, permissions: `${READ},${CLOSE}`, body: { expected_version: '1', expected_draft_version: '1' }, path: '/close' });
    assert.equal(closed.status, 200); assert.equal(closed.body.status, 'closed'); assert.equal(closed.body.closed_by, teacher);
    assert.equal(closed.body.teacher_habilitation_id, 'teacher-period');
  });
  assert.equal(state.report.status, 'closed');
});

test('S3 close boundary: admins, students, and teachers without the close permission cannot close and nothing changes', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    const denied = [
      { role: 'admin', user: admin, permissions: `${READ},${CLOSE}` },
      { role: 'estudiante', user: author, permissions: `${READ},${WRITE},${CLOSE}` },
      { role: 'teacher', user: teacher, permissions: READ },
    ];
    for (const attempt of denied) {
      assert.equal((await call('POST', { ...attempt, body: { expected_version: '1', expected_draft_version: '1' }, path: '/close' })).status, 403);
    }
  });
  assert.equal(state.report.status, 'draft'); assert.equal(state.writes, 1);
});

test('S3 lock: a closed report refuses PATCH with 409 and its diagnostic draft refuses PATCH too', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    await call('POST', { role: 'teacher', user: teacher, permissions: `${READ},${CLOSE}`, body: { expected_version: '1', expected_draft_version: '1' }, path: '/close' });
    const reportPatch = await call('PATCH', { body: { expected_version: '2', content: { diagnosis: 'after close' } } });
    assert.equal(reportPatch.status, 409); assert.equal(reportPatch.body.error.code, 'CONFLICT');
  });
  assert.equal(state.report.status, 'closed'); assert.deepEqual(state.report.content, content);
});

test('S3 lock: draft PATCH is rejected once the report is closed, even with the draft version the author last saw', async () => {
  const { state, repo } = fakeStore();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.auth = { userId: author, role: 'estudiante', permissions: [READ, WRITE] }; next(); });
  app.use('/endodontics-drafts', createEndodonticsDraftRouter({ repository: repo })); app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/endodontics-drafts/22`;
  try {
    await repo.createTreatmentReport('22', content, { id: author, role: 'estudiante' });
    await repo.closeTreatmentReport('22', '1', '1', { id: teacher, role: 'teacher' });
    const response = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: '1', content: { tooth_or_region: '16' } }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error.message, /closed treatment report/);
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(state.draft.version, '1'); assert.deepEqual(state.draft.content, {});
});

test('S2/S4/S5 invalid payloads are rejected before any write and leave the stored report untouched', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    const invalid = [
      { content: { treated_teeth: Array.from({ length: 9 }, (_, i) => `${i + 11}`) } },
      { content: { session_count: -1 } },
      { content: { session_count: 1.5 } },
      { content: { patient_name: 'Ana' } },
      { content: { canal_measurements: [{ tooth: '16', canal: 'MV', unexpected: '1' }] } },
      { content: { canal_measurements: [{ tooth: '16', obturation_cut: { option: 'middle' } }] } },
      { content: { observations: 'a\u0000b' } },
      { content: { observations: '\uD800' } },
      { content: { diagnosis: 'x' }, extra: true },
      { content: {}, expected_version: '1' },
    ];
    for (const body of invalid) assert.equal((await call('POST', { body })).status, 400);
    assert.equal(state.report, null);
    await call('POST', { body: { content } });
    const before = JSON.stringify(state.report);
    for (const body of [{ expected_version: 'one', content: {} }, { expected_version: '1', content: { session_count: '2' } }, { content }]) {
      assert.equal((await call('PATCH', { body })).status, 400);
    }
    assert.equal(JSON.stringify(state.report), before);
    assert.equal(state.writes, 1);
  });
});

test('S4: a zero session count is accepted and stored as an integer', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    assert.equal((await call('POST', { body: { content: { session_count: 0 } } })).status, 201);
  });
  assert.equal(state.report.content.session_count, 0);
});

const closeBody = (body) => ({ role: 'teacher', user: teacher, permissions: `${READ},${CLOSE}`, body, path: '/close' });

test('F2: close is bound to the draft version; a draft that changed since expected_draft_version conflicts and the report stays open', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    await repo.edit('22', '1', { tooth_or_region: '16' }, { id: author, role: 'estudiante' });
    const stale = await call('POST', closeBody({ expected_version: '1', expected_draft_version: '1' }));
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'CONFLICT');
    assert.equal(state.report.status, 'draft'); assert.equal(state.report.version, '1');
    const current = await call('POST', closeBody({ expected_version: '1', expected_draft_version: '2' }));
    assert.equal(current.status, 200); assert.equal(current.body.status, 'closed');
  });
});

test('F2: close requires expected_draft_version; omitting it is 400 and changes nothing', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    const missing = await call('POST', closeBody({ expected_version: '1' }));
    assert.equal(missing.status, 400);
    assert.equal(state.report.status, 'draft'); assert.equal(state.report.version, '1');
  });
});

test('F2: a stale report expected_version conflicts with 409 and leaves the report open', async () => {
  const { state, repo } = fakeStore();
  await serve(repo, async call => {
    await call('POST', { body: { content } });
    const stale = await call('POST', closeBody({ expected_version: '9', expected_draft_version: '1' }));
    assert.equal(stale.status, 409);
    assert.equal(state.report.status, 'draft');
  });
});
