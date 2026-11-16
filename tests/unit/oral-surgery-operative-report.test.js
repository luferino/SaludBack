import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createOralSurgeryDraftRouter } from '../../src/modules/oral-surgery-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { PgOralSurgeryDraftRepository } from '../../src/modules/oral-surgery-drafts/infrastructure/pg-oral-surgery-draft.repository.ts';

const user = '10000000-0000-4000-8000-000000000001';
const headers = (role = 'estudiante', permissions = 'oral-surgery-drafts:write,oral-surgery-drafts:read,oral-surgery-drafts:close') =>
  ({ 'content-type': 'application/json', 'x-role': role, 'x-permissions': permissions });
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
  try {
    await run(async (method, suffix = '', body, auth = headers()) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/oral-surgery-drafts/1${suffix}`,
        { method, headers: auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
const content = { narrative: 'Extraction completed', asepsis: { extraoral: 'Antiseptic', intraoral: null },
  anesthesia: { technique: 'Local', drug: 'Example', dose: 'As recorded' },
  extraction: { technique: 'Forceps', teeth: '18', suture: 'Simple' },
  prescription: { medications: 'Drug 1', commercial_name: null, route: 'Oral', dose: 'Recorded', frequency: 'Recorded', duration: 'Recorded' },
  postoperative_instructions: 'Review instructions', operative_incident: null };

test('S1/S3: persistence serializes on the live student context and binds the current authorization snapshot', async () => {
  const calls = [];
  const queries = [];
  const encounter = { id: '1', clinical_record_id: '10', patient_id: '10000000-0000-4000-8000-000000000002',
    author_id: user, origin_student_habilitation_id: 'period', origin_subject_id: 'subject', origin_group_id: 'group',
    content: {}, status: 'draft', version: '3', created_at: new Date(), updated_at: new Date() };
  const report = { draft_id: '1', draft_version: '3', authorization_id: '9', content: {}, version: '1', status: 'draft' };
  const db = { async query(sql, params) {
    calls.push(sql);
    queries.push({ sql, params });
    if (sql.includes('FROM oral_surgery_drafts e WHERE e.id = $1 AND e.author_id = $2')) return { rows: [encounter] };
    if (sql.includes('FROM students WHERE')) return { rows: [{ id: 'student' }] };
    if (sql.includes('FROM student_academic_habilitations h')) return { rows: [{ id: 'period' }] };
    if (sql.includes('FROM patients WHERE')) return { rows: [{ id: encounter.patient_id }] };
    if (sql.includes('FROM patient_assignments a')) return { rows: [{ id: 'assignment', student_habilitation_id: 'period' }] };
    if (sql.includes('SELECT version::text FROM oral_surgery_drafts')) return { rows: [{ version: '3' }] };
    if (sql.includes('FROM oral_surgery_operative_reports WHERE draft_id = $1 FOR UPDATE')) return { rows: [] };
    if (sql.includes('FROM oral_surgery_authorizations')) {
      assert.deepEqual(params, ['1', '3']); return { rows: [{ id: '9' }] };
    }
    if (sql.includes('INSERT INTO oral_surgery_operative_reports')) {
      assert.deepEqual(params.slice(0, 3), ['1', '3', '9']); return { rows: [report] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  const repository = new PgOralSurgeryDraftRepository({ async withTransaction(run) { return run(db); } }, db);
  assert.deepEqual(await repository.createOperativeReport('1', '3', {}, { id: user, role: 'estudiante' }), report);
  assert.match(queries.find(query => query.sql.includes('INSERT INTO oral_surgery_operative_reports')).sql,
    /INSERT INTO oral_surgery_operative_reports AS r[\s\S]*RETURNING r\.draft_id/);
  const locks = calls.filter(sql => /FOR UPDATE OF h|FROM patients WHERE|FOR UPDATE OF a|FROM oral_surgery_drafts WHERE id = \$1 FOR UPDATE/.test(sql));
  assert.equal(locks.length, 4);
  const periodLock = calls.findIndex(sql => sql.includes('FOR UPDATE OF h'));
  const patientLock = calls.findIndex(sql => sql.includes('FROM patients WHERE'));
  const assignmentLock = calls.findIndex(sql => sql.includes('FOR UPDATE OF a'));
  const draftLock = calls.findIndex(sql => sql.includes('FROM oral_surgery_drafts WHERE id = $1 FOR UPDATE'));
  assert.ok(periodLock < patientLock && patientLock < assignmentLock && assignmentLock < draftLock);
});

test('S2: closing a missing report on an accessible encounter returns the report 404 without writes', async () => {
  let updated = false;
  const db = { async query(sql) {
    if (sql.includes('FROM oral_surgery_drafts e WHERE e.id = $1')) return { rows: [{
      id: '1', clinical_record_id: '10', patient_id: 'patient', author_id: user,
      origin_subject_id: 'subject', origin_group_id: 'group',
    }] };
    if (sql.includes('FROM teacher_academic_habilitations th')) return { rows: [{ id: 'teacher-period' }] };
    if (sql.includes('SELECT version::text FROM oral_surgery_drafts')) return { rows: [{ version: '1' }] };
    if (sql.includes('FROM oral_surgery_operative_reports WHERE draft_id = $1 FOR UPDATE')) return { rows: [] };
    if (sql.includes('UPDATE oral_surgery_operative_reports')) { updated = true; return { rows: [{}] }; }
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  const repository = new PgOralSurgeryDraftRepository({ async withTransaction(run) { return run(db); } }, db);
  await assert.rejects(repository.closeOperativeReport('1', '1', '1', { id: user, role: 'teacher' }),
    error => error.statusCode === 404 && error.message === 'oral surgery operative report was not found');
  assert.equal(updated, false);
});

test('S2: close rejects an operative report saved against an older clinical version without writes', async () => {
  let updated = false;
  let reportDraftVersion = '1';
  let bindingAllowed = false;
  const db = { async query(sql) {
    if (sql.includes('FROM oral_surgery_drafts e WHERE e.id = $1')) return { rows: [{
      id: '1', clinical_record_id: '10', patient_id: 'patient', author_id: user,
      origin_subject_id: 'subject', origin_group_id: 'group',
    }] };
    if (sql.includes('FROM teacher_academic_habilitations th')) return { rows: [{ id: 'teacher-period' }] };
    if (sql.includes('SELECT version::text FROM oral_surgery_drafts')) return { rows: [{ version: '2' }] };
    if (sql.includes('FROM oral_surgery_operative_reports WHERE draft_id = $1 FOR UPDATE'))
      return { rows: [{ version: '3', status: 'draft', draft_version: reportDraftVersion, authorization_id: '9' }] };
    if (sql.includes('FROM oral_surgery_authorizations')) return { rows: bindingAllowed ? [{ id: '9' }] : [] };
    if (sql.includes('UPDATE oral_surgery_operative_reports')) { updated = true; return { rows: [{ status: 'closed' }] }; }
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  const repository = new PgOralSurgeryDraftRepository({ async withTransaction(run) { return run(db); } }, db);
  await assert.rejects(repository.closeOperativeReport('1', '3', '2', { id: user, role: 'teacher' }),
    error => error.statusCode === 409 && error.message === 'operative report does not match current clinical version; save it before closing');
  assert.equal(updated, false);
  reportDraftVersion = '2';
  await assert.rejects(repository.closeOperativeReport('1', '3', '2', { id: user, role: 'teacher' }),
    error => error.statusCode === 409 && error.message === 'operative report does not match current clinical version; save it before closing');
  assert.equal(updated, false);
});

test('S1/S3: public API saves incomplete operative reports and round-trips source fields without editing preoperative data', async () => {
  let row;
  await serve({
    async createOperativeReport(id, draftVersion, data, actor) {
      assert.equal(id, '1'); assert.equal(draftVersion, '3'); assert.deepEqual(data, {});
      assert.deepEqual(actor, { id: user, role: 'estudiante' });
      row = { draft_id: id, draft_version: draftVersion, content: data, version: '1', status: 'draft' };
      return row;
    },
    async editOperativeReport(id, version, draftVersion, data, actor) {
      assert.equal(id, '1'); assert.equal(version, '1'); assert.equal(draftVersion, '3'); assert.equal(actor.id, user);
      row = { ...row, content: data, version: '2' }; return row;
    },
    async getOperativeReport(id, actor) { assert.equal(id, '1'); assert.equal(actor.id, user); return row; },
  }, async request => {
    const created = await request('POST', '/operative-report', { expected_draft_version: '3', content: {} });
    assert.deepEqual(created, { status: 201, body: row });
    const saved = await request('PATCH', '/operative-report', { expected_draft_version: '3', expected_version: '1', content });
    assert.deepEqual(saved, { status: 200, body: row }); assert.deepEqual(saved.body.content, content);
    assert.deepEqual(await request('GET', '/operative-report'), { status: 200, body: row });
  });
});

test('S2: only the teacher closes the exact reviewed report and clinical versions', async () => {
  let calls = 0;
  await serve({ async closeOperativeReport(id, version, draftVersion, actor) {
    calls++; assert.equal(id, '1'); assert.equal(version, '2'); assert.equal(draftVersion, '3');
    assert.deepEqual(actor, { id: user, role: 'teacher' });
    return { status: 'closed', version: '3', closed_by: user };
  } }, async request => {
    const body = { expected_version: '2', expected_draft_version: '3' };
    const response = await request('POST', '/operative-report/close', body, headers('teacher'));
    assert.deepEqual(response, { status: 200, body: { status: 'closed', version: '3', closed_by: user } });
    for (const role of ['estudiante', 'admin']) {
      assert.deepEqual(await request('POST', '/operative-report/close', body, headers(role)),
        { status: 403, body: { error: { code: 'FORBIDDEN', message: 'teacher instructor role required' } } });
    }
    assert.deepEqual(await request('POST', '/operative-report/close', body, headers('teacher', 'oral-surgery-drafts:read')),
      { status: 403, body: { error: { code: 'FORBIDDEN', message: "Permission 'oral-surgery-drafts:close' required" } } });
  });
  assert.equal(calls, 1);
});

test('S1/S2: malformed, forged, anonymous or nonstudent writes never reach storage', async () => {
  let calls = 0;
  const write = async () => { calls++; return {}; };
  await serve({ createOperativeReport: write, editOperativeReport: write, closeOperativeReport: write }, async request => {
    const valid = { expected_draft_version: '1', content: {} };
    for (const invalid of [{ ...valid, expected_draft_version: '0' }, { ...valid, content: { grading: {} } },
      { ...valid, content: { anesthesia: { drug: 5 } } }, { ...valid, closed_by: user },
      { ...valid, content: { narrative: 'a\u0000' } }, { ...valid, content: { narrative: 'x'.repeat(4001) } },
      { ...valid, content: null }, { ...valid, content: { asepsis: [] } }, { content: {} }]) {
      const result = await request('POST', '/operative-report', invalid);
      assert.equal(result.status, 400); assert.equal(result.body.error.code, 'BAD_REQUEST');
    }
    for (const role of ['teacher', 'admin']) {
      assert.deepEqual(await request('POST', '/operative-report', valid, headers(role)),
        { status: 403, body: { error: { code: 'FORBIDDEN', message: 'student author role required' } } });
    }
    assert.equal((await request('POST', '/operative-report', valid, {})).status, 401);
    assert.equal((await request('PATCH', '/operative-report', { ...valid, expected_version: '01' })).status, 400);
    assert.equal((await request('POST', '/operative-report/close', { expected_version: '1', expected_draft_version: '1', status: 'closed' }, headers('teacher'))).status, 400);
  });
  assert.equal(calls, 0);
});

test('S3: existing encounter PATCH, consent declaration and instructor authorization keep their input contracts', async () => {
  const saved = { id: '1', version: '2', content: {}, created_at: '2026-11-16', updated_at: '2026-11-16' };
  await serve({
    async edit(id, version, data) { assert.equal(id, '1'); assert.equal(version, '1'); assert.deepEqual(data, {}); return saved; },
    async declareConsent(id, version) { assert.equal(id, '1'); assert.equal(version, '1'); return { id: '4' }; },
    async authorizeSurgery(id, version, consent) { assert.equal(id, '1'); assert.equal(version, '1'); assert.equal(consent, '4'); return { id: '5' }; },
  }, async request => {
    assert.equal((await request('PATCH', '', { expected_version: '1', content: {} })).status, 200);
    assert.deepEqual(await request('POST', '/consent', { expected_version: '1', paper_signed: true }), { status: 201, body: { id: '4' } });
    assert.deepEqual(await request('POST', '/authorizations', { expected_version: '1', consent_declaration_id: '4', paper_consent_verified: true },
      headers('teacher', 'oral-surgery-drafts:authorize')), { status: 201, body: { id: '5' } });
  });
});
