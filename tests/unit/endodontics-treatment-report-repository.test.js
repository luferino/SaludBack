import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PgEndodonticsDraftRepository } from '../../src/modules/endodontics-drafts/infrastructure/pg-endodontics-draft.repository.ts';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';

const ids = { user: '10000000-0000-4000-8000-000000000001', patient: '10000000-0000-4000-8000-000000000002',
  subject: '10000000-0000-4000-8000-000000000003', group: '10000000-0000-4000-8000-000000000004',
  period: '10000000-0000-4000-8000-000000000005', teacher: '10000000-0000-4000-8000-000000000007',
  teacherPeriod: '10000000-0000-4000-8000-000000000006' };
const draft = { id: '22', clinical_record_id: '10', patient_id: ids.patient, author_id: ids.user,
  origin_student_habilitation_id: ids.period, origin_subject_id: ids.subject, origin_group_id: ids.group,
  content: {}, status: 'draft', version: '1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const report = { draft_id: '22', content: {}, version: '1', status: 'draft', created_by: ids.user,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', closed_by: null, closed_at: null, teacher_habilitation_id: null };
const content = { diagnosis: 'texto' };

// Reply-queue double: each query consumes the next scripted reply, so any extra or reordered SQL fails loudly.
function transactionDouble(replies) {
  const calls = [];
  const db = { async query(sql, params = []) {
    calls.push({ sql, params });
    const next = replies.shift();
    if (next === undefined) throw new Error(`unexpected SQL: ${sql}`);
    return { rows: typeof next === 'function' ? next(sql, params) : next };
  } };
  return { calls, uow: { async withTransaction(fn) { return fn(db); } } };
}
const studentLocks = [[{ id: 'student-profile' }], [{ id: ids.period }], [{ id: ids.patient }],
  [{ student_habilitation_id: ids.period }]];
const studentActor = { id: ids.user, role: 'estudiante' };
const tableOf = (sql) => sql.match(/(?:FROM|INTO|UPDATE)\s+([\w.]+)/)?.[1];

test('S2/S3 create: author context is locked, the draft is locked, one report per draft is checked, then the report is inserted', async () => {
  const fake = transactionDouble([[draft], ...studentLocks, [{ version: '1' }], [], [report]]);
  const result = await new PgEndodonticsDraftRepository(fake.uow, {}).createTreatmentReport('22', content, studentActor);
  assert.deepEqual(result, report);
  const order = fake.calls.map(call => `${tableOf(call.sql)}${/FOR UPDATE/.test(call.sql) ? ':lock' : ''}`);
  assert.deepEqual(order, ['endodontics_drafts', 'students', 'student_academic_habilitations:lock', 'patients:lock',
    'patient_assignments:lock', 'endodontics_drafts:lock', 'endodontics_treatment_reports:lock', 'endodontics_treatment_reports']);
  assert.match(fake.calls.at(-1).sql, /INSERT INTO endodontics_treatment_reports/);
  assert.deepEqual(fake.calls.at(-1).params, ['22', JSON.stringify(content), ids.user]);
});

test('S2: a second report for the same draft conflicts with 409 after the lock and inserts nothing', async () => {
  const fake = transactionDouble([[draft], ...studentLocks, [{ version: '1' }], [{ '?column?': 1 }]]);
  await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).createTreatmentReport('22', content, studentActor),
    (error) => error instanceof ConflictError && /already exists/.test(error.message));
  assert.equal(fake.calls.some(call => /INSERT INTO/.test(call.sql)), false);
});

test('S3 boundary: only a student author can create; other roles fail before any SQL', async () => {
  for (const role of ['teacher', 'admin']) {
    const fake = transactionDouble([]);
    await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).createTreatmentReport('22', content, { id: ids.teacher, role }),
      ForbiddenError);
    assert.equal(fake.calls.length, 0);
  }
});

test('S3 boundary: a create from another student, outside context, is reported as a missing draft without writes', async () => {
  const fake = transactionDouble([[]]);
  await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).createTreatmentReport('22', content,
    { id: '10000000-0000-4000-8000-000000000099', role: 'estudiante' }), /endodontics draft was not found/);
  assert.equal(fake.calls.some(call => /INSERT INTO/.test(call.sql)), false);
});

test('S2/S3 edit: stale expected_version conflicts after the draft and report locks and never updates', async () => {
  const fake = transactionDouble([[draft], ...studentLocks, [{ id: '22' }], [{ version: '2', status: 'draft' }]]);
  await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).editTreatmentReport('22', '1', content, studentActor),
    (error) => error instanceof ConflictError);
  assert.equal(fake.calls.some(call => /UPDATE endodontics_treatment_reports/.test(call.sql)), false);
});

test('S3 lock: a closed report refuses report PATCH with 409 and never updates', async () => {
  const fake = transactionDouble([[draft], ...studentLocks, [{ id: '22' }], [{ version: '1', status: 'closed' }]]);
  await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).editTreatmentReport('22', '1', content, studentActor),
    (error) => error instanceof ConflictError && /closed/.test(error.message));
  assert.equal(fake.calls.some(call => /UPDATE endodontics_treatment_reports/.test(call.sql)), false);
});

test('S2/S3 edit: an open report with the current version is replaced in place and its version advances', async () => {
  const updated = { ...report, content, version: '2' };
  const fake = transactionDouble([[draft], ...studentLocks, [{ id: '22' }], [{ version: '1', status: 'draft' }], [updated]]);
  const result = await new PgEndodonticsDraftRepository(fake.uow, {}).editTreatmentReport('22', '1', content, studentActor);
  assert.equal(result.version, '2');
  const update = fake.calls.at(-1).sql;
  assert.match(update, /UPDATE endodontics_treatment_reports/);
  assert.match(update, /version = version \+ 1/);
  assert.match(update, /status = 'draft'/);
  assert.doesNotMatch(update.split(' WHERE ')[0], /closed_by|closed_at|teacher_habilitation_id|draft_id/);
});

test('S3 lock: the report is read only after the draft row lock, so a concurrent close cannot be missed', async () => {
  const fake = transactionDouble([[draft], ...studentLocks, [{ id: '22' }], [{ version: '1', status: 'draft' }], [{ ...report, version: '2' }]]);
  await new PgEndodonticsDraftRepository(fake.uow, {}).editTreatmentReport('22', '1', content, studentActor);
  const lock = fake.calls.findIndex(call => /FROM endodontics_drafts WHERE id=\$1 FOR UPDATE/.test(call.sql));
  const reportRead = fake.calls.findIndex(call => /FROM endodontics_treatment_reports WHERE draft_id=\$1 FOR UPDATE/.test(call.sql));
  assert.ok(lock >= 0 && reportRead > lock);
});

test('S3 close: the in-context teacher locks the teacher period, then the draft, then the report, and records closure audit', async () => {
  const closed = { ...report, status: 'closed', version: '2', closed_by: ids.teacher, closed_at: '2026-01-02T00:00:00Z', teacher_habilitation_id: ids.teacherPeriod };
  const fake = transactionDouble([[draft], [{ id: ids.teacherPeriod }], [{ version: '1' }], [{ version: '1', status: 'draft' }], [closed]]);
  const result = await new PgEndodonticsDraftRepository(fake.uow, {}).closeTreatmentReport('22', '1', '1', { id: ids.teacher, role: 'teacher' });
  assert.equal(result.status, 'closed');
  const order = fake.calls.map(call => `${tableOf(call.sql)}${/FOR UPDATE/.test(call.sql) ? ':lock' : ''}`);
  assert.deepEqual(order, ['endodontics_drafts', 'teacher_academic_habilitations:lock', 'endodontics_drafts:lock',
    'endodontics_treatment_reports:lock', 'endodontics_treatment_reports']);
  assert.match(fake.calls[1].sql, /t\.user_id = \$1|t\.user_id=\$1/);
  assert.match(fake.calls[1].sql, /th\.revoked_at IS NULL/);
  assert.deepEqual(fake.calls.at(-1).params, ['22', '1', ids.teacher, ids.teacherPeriod]);
});

test('S3 close boundary: admins and students cannot close and nothing is read or written', async () => {
  for (const role of ['admin', 'estudiante']) {
    const fake = transactionDouble([]);
    await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).closeTreatmentReport('22', '1', '1', { id: ids.user, role }),
      ForbiddenError);
    assert.equal(fake.calls.length, 0);
  }
});

test('S3 close: a teacher outside the draft subject/group, or a stale report version, changes nothing', async () => {
  const outside = transactionDouble([[draft], []]);
  await assert.rejects(new PgEndodonticsDraftRepository(outside.uow, {}).closeTreatmentReport('22', '1', '1', { id: ids.teacher, role: 'teacher' }),
    NotFoundError);
  assert.equal(outside.calls.some(call => /UPDATE endodontics_treatment_reports/.test(call.sql)), false);
  const stale = transactionDouble([[draft], [{ id: ids.teacherPeriod }], [{ version: '1' }], [{ version: '2', status: 'draft' }]]);
  await assert.rejects(new PgEndodonticsDraftRepository(stale.uow, {}).closeTreatmentReport('22', '1', '1', { id: ids.teacher, role: 'teacher' }),
    (error) => error instanceof ConflictError);
  assert.equal(stale.calls.some(call => /UPDATE endodontics_treatment_reports/.test(call.sql)), false);
});

test('F2 close: a draft version that differs from expected_draft_version conflicts under the draft lock and never touches the report', async () => {
  const fake = transactionDouble([[draft], [{ id: ids.teacherPeriod }], [{ version: '2' }]]);
  await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).closeTreatmentReport('22', '1', '1', { id: ids.teacher, role: 'teacher' }),
    (error) => error instanceof ConflictError && /draft version changed/.test(error.message));
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls.some(call => /endodontics_treatment_reports/.test(call.sql)), false);
});

test('S3 lock: the diagnostic draft refuses PATCH once its report is closed; the closed-state check is a separate query after the draft lock', async () => {
  const fake = transactionDouble([[draft], ...studentLocks, [{ version: '1' }], [{ '?column?': 1 }]]);
  await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).edit('22', '1', { changed: true }, studentActor),
    (error) => error instanceof ConflictError && /closed treatment report/.test(error.message));
  const lock = fake.calls.findIndex(call => /FROM endodontics_drafts/.test(call.sql) && /FOR UPDATE/.test(call.sql));
  const closedCheck = fake.calls.findIndex(call => /FROM endodontics_treatment_reports/.test(call.sql) && /status = 'closed'/.test(call.sql));
  assert.ok(lock >= 0, 'draft row lock is taken');
  assert.doesNotMatch(fake.calls[lock].sql, /endodontics_treatment_reports/);
  assert.ok(closedCheck > lock, 'closed-state check runs after the draft lock');
  assert.equal(fake.calls.some(call => /UPDATE\s+endodontics_drafts/.test(call.sql)), false);
});

test('F1 docs: the lock-order description states the separate post-lock closed-state check', () => {
  const docs = readFileSync('docs/endodontics.md', 'utf8');
  assert.match(docs, /take the draft row lock first, then run a separate closed-state check/);
  assert.doesNotMatch(docs, /under that same lock|same draft row lock/);
});

test('F4 docs: the student lock order names the patient row lock', () => {
  const docs = readFileSync('docs/endodontics.md', 'utf8');
  assert.match(docs, /the active student period, the patient row, the active assignment, the draft row, then the report row/);
});

test('S3 read scope: the report is read through the same draft access predicate and is hidden when missing', async () => {
  const queries = [];
  const pool = { async query(sql, params) {
    queries.push({ sql, params });
    if (params[0] === '22' && params[2] === 'teacher' && params[1] === ids.teacher) return { rows: [report] };
    return { rows: [] };
  } };
  const repo = new PgEndodonticsDraftRepository({}, pool);
  assert.deepEqual(await repo.getTreatmentReport('22', { id: ids.teacher, role: 'teacher' }), report);
  await assert.rejects(repo.getTreatmentReport('22', { id: ids.user, role: 'estudiante' }), /endodontics treatment report was not found/);
  const sql = queries[0].sql;
  assert.match(sql, /FROM endodontics_treatment_reports r/);
  assert.match(sql, /JOIN endodontics_drafts e ON e\.id = r\.draft_id/);
  assert.match(sql, /\$3 = 'admin'/);
  assert.match(sql, /t\.user_id=\$2/);
});
