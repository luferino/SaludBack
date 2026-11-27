import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createEndodonticsDraftRouter } from '../../src/modules/endodontics-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { NotFoundError } from '../../src/modules/shared/domain/errors.ts';
import { PgEndodonticsDraftRepository } from '../../src/modules/endodontics-drafts/infrastructure/pg-endodontics-draft.repository.ts';

const ids = { user: '10000000-0000-4000-8000-000000000001', patient: '10000000-0000-4000-8000-000000000002', subject: '10000000-0000-4000-8000-000000000003', group: '10000000-0000-4000-8000-000000000004', period: '10000000-0000-4000-8000-000000000005', record: '10' };
const draft = { id: '22', clinical_record_id: ids.record, patient_id: ids.patient, author_id: ids.user,
  origin_student_habilitation_id: ids.period, origin_subject_id: ids.subject, origin_group_id: ids.group,
  content: {}, status: 'draft', version: '1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
function transactionDouble(replies) {
  const calls = [];
  const db = { async query(sql, params = []) { calls.push({ sql, params }); const next = replies.shift();
    if (!next) throw new Error(`unexpected SQL: ${sql}`); return { rows: typeof next === 'function' ? next(sql, params) : next }; } };
  return { calls, uow: { async withTransaction(fn) { return fn(db); } } };
}

async function serveDraftRoutes(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: String(req.headers['x-user'] ?? ids.user), role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/endodontics-drafts', createEndodonticsDraftRouter({ repository })); app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/endodontics-drafts`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('public routes permit context teacher/admin reads but never teacher/admin writes or cross-context disclosure', async () => {
  const calls = [];
  const repo = {
    async get(id, actor) { calls.push(['get', id, actor]);
      if (actor.role === 'teacher' && id === '404') throw new NotFoundError('endodontics draft was not found');
      return draft; },
    async create() { calls.push(['create']); return draft; },
  };
  await serveDraftRoutes(repo, async base => {
    for (const role of ['teacher', 'admin']) {
      const response = await fetch(`${base}/22`, { headers: { 'x-role': role, 'x-permissions': 'endodontics-drafts:read' } });
      assert.equal(response.status, 200);
    }
    const outside = await fetch(`${base}/404`, { headers: { 'x-role': 'teacher', 'x-permissions': 'endodontics-drafts:read' } });
    assert.equal(outside.status, 404); assert.deepEqual(await outside.json(), { error: { code: 'NOT_FOUND', message: 'endodontics draft was not found' } });
    for (const role of ['teacher', 'admin']) {
      const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-role': role,
        'x-permissions': 'endodontics-drafts:read' }, body: JSON.stringify({ ...ids, content: {} }) });
      assert.equal(response.status, 403);
    }
  });
  assert.deepEqual(calls.map(x => x[0]), ['get', 'get', 'get']);
});

test('create locks and checks the exact current author context and assignment, reuses shared history, and aliases INSERT target for RETURNING', async () => {
  const fake = transactionDouble([
    [{ id: 'student-profile' }], [{ id: ids.period }], [{ id: ids.patient }],
    [{ id: 'assignment', student_habilitation_id: ids.period }], [], [{ id: ids.record }], [draft],
  ]);
  const repository = new PgEndodonticsDraftRepository(fake.uow, {});
  const result = await repository.create({ patientId: ids.patient, subjectId: ids.subject, groupId: ids.group, content: {} }, { id: ids.user, role: 'estudiante' });
  assert.equal(result.id, draft.id);
  const period = fake.calls.find(x => x.sql.includes('student_academic_habilitations'));
  assert.match(period.sql, /h\.student_id=\$1/); assert.match(period.sql, /h\.subject_id=\$2/);
  assert.match(period.sql, /h\.academic_group_id=\$3/); assert.match(period.sql, /h\.revoked_at IS NULL/);
  assert.match(period.sql, /FOR UPDATE OF h/);
  const assignment = fake.calls.find(x => x.sql.includes('FROM patient_assignments'));
  assert.match(assignment.sql, /a\.ended_at IS NULL/); assert.match(assignment.sql, /FOR UPDATE/);
  assert.deepEqual(fake.calls.map(x => x.sql.match(/(?:FROM|INTO)\s+([\w.]+)/)?.[1]).filter(Boolean).slice(0, 7),
    ['students', 'student_academic_habilitations', 'patients', 'patient_assignments', 'clinical_records', 'clinical_records', 'endodontics_drafts']);
  const insert = fake.calls.at(-1).sql;
  assert.match(insert, /INSERT INTO endodontics_drafts AS e/);
  assert.match(insert, /RETURNING e\.id::text/);
});

test('creation rejects a missing shared patient before history creation', async () => {
  const fake = transactionDouble([[{ id: 'student-profile' }], [{ id: ids.period }], []]);
  await assert.rejects(new PgEndodonticsDraftRepository(fake.uow, {}).create(
    { patientId: ids.patient, subjectId: ids.subject, groupId: ids.group, content: {} }, { id: ids.user, role: 'estudiante' }), /patient was not found/);
  assert.equal(fake.calls.some(x => /INSERT INTO (clinical_records|endodontics_drafts)/.test(x.sql)), false);
});

test('draft schema preserves patient/context/author origin while allowing only mutable draft fields', () => {
  const sql = readFileSync('src/db/migrations/067_create_endodontics_drafts.sql', 'utf8');
  assert.match(sql, /FOREIGN KEY \(clinical_record_id, patient_id\) REFERENCES clinical_records\(id, patient_id\)/);
  assert.match(sql, /FOREIGN KEY \(origin_student_habilitation_id, origin_subject_id, origin_group_id\)/);
  assert.match(sql, /ROW\(NEW\.id, NEW\.clinical_record_id, NEW\.patient_id, NEW\.author_id, NEW\.origin_student_habilitation_id/);
  assert.match(sql, /BEFORE UPDATE ON endodontics_drafts/);
});

test('new history insert is returned, and origin identity is passed once into immutable draft creation', async () => {
  const fake = transactionDouble([
    [{ id: 'student-profile' }], [{ id: ids.period }], [{ id: ids.patient }],
    [{ id: 'assignment', student_habilitation_id: ids.period }], [{ id: ids.record }], [draft],
  ]);
  await new PgEndodonticsDraftRepository(fake.uow, {}).create({ patientId: ids.patient, subjectId: ids.subject, groupId: ids.group, content: { note: 'x' } }, { id: ids.user, role: 'estudiante' });
  const insert = fake.calls.at(-1);
  assert.match(insert.sql, /INSERT INTO endodontics_drafts AS e/);
  assert.deepEqual(insert.params.slice(0, 6), [ids.record, ids.patient, ids.user, ids.period, ids.subject, ids.group]);
  assert.equal(JSON.parse(insert.params[6]).note, 'x');
});

test('read predicates allow author/current context, deny other student and teacher contexts, and keep admin global', async () => {
  const queries = [];
  const pool = { async query(sql, params) {
    queries.push({ sql, params });
    assert.match(sql, /h\.revoked_at IS NULL/); assert.match(sql, /a\.ended_at IS NULL/);
    if (params[2] === 'admin' || (params[2] === 'estudiante' && params[1] === ids.user)
        || (params[2] === 'teacher' && params[1] === ids.user)) return { rows: [draft] };
    return { rows: [] };
  } };
  const repo = new PgEndodonticsDraftRepository({}, pool);
  await repo.get(draft.id, { id: ids.user, role: 'estudiante' });
  await assert.rejects(repo.get(draft.id, { id: '10000000-0000-4000-8000-000000000099', role: 'estudiante' }), /endodontics draft was not found/);
  await repo.get(draft.id, { id: ids.user, role: 'teacher' });
  await assert.rejects(repo.get(draft.id, { id: '10000000-0000-4000-8000-000000000098', role: 'teacher' }), /endodontics draft was not found/);
  await repo.get(draft.id, { id: '10000000-0000-4000-8000-000000000097', role: 'admin' });
  const sql = queries[0].sql;
  assert.match(sql, /e\.author_id = \$2/); assert.match(sql, /h\.revoked_at IS NULL/); assert.match(sql, /a\.ended_at IS NULL/);
  assert.match(sql, /h\.subject_id=e\.origin_subject_id/); assert.match(sql, /h\.academic_group_id=e\.origin_group_id/);
  assert.match(sql, /t\.user_id=\$2/); assert.match(sql, /\$3\s*=\s*'admin'/);
  assert.deepEqual(queries.map(x => x.params), [[draft.id, ids.user, 'estudiante'],
    [draft.id, '10000000-0000-4000-8000-000000000099', 'estudiante'], [draft.id, ids.user, 'teacher'],
    [draft.id, '10000000-0000-4000-8000-000000000098', 'teacher'],
    [draft.id, '10000000-0000-4000-8000-000000000097', 'admin']]);
});

test('inactive habilitation and ended/revoked assignment deny create before either shared-history or draft insertion', async () => {
  const inactive = transactionDouble([[{ id: 'student-profile' }], []]);
  await assert.rejects(new PgEndodonticsDraftRepository(inactive.uow, {}).create(
    { patientId: ids.patient, subjectId: ids.subject, groupId: ids.group, content: {} }, { id: ids.user, role: 'estudiante' }), /active enabled student context/);
  assert.equal(inactive.calls.length, 2);
  const unassigned = transactionDouble([[{ id: 'student-profile' }], [{ id: ids.period }], [{ id: ids.patient }], []]);
  await assert.rejects(new PgEndodonticsDraftRepository(unassigned.uow, {}).create(
    { patientId: ids.patient, subjectId: ids.subject, groupId: ids.group, content: {} }, { id: ids.user, role: 'estudiante' }), /patient was not found/);
  assert.equal(unassigned.calls.some(x => /INSERT INTO (clinical_records|endodontics_drafts)/.test(x.sql)), false);
  assert.match(unassigned.calls.at(-1).sql, /a\.ended_at IS NULL/);
});

test('a new active period and its current assignment restore the original student author’s write access', async () => {
  const reactivatedPeriod = '10000000-0000-4000-8000-000000000099';
  const fake = transactionDouble([
    [{ id: 'student-profile' }], [{ id: reactivatedPeriod }], [{ id: ids.patient }],
    [{ student_habilitation_id: reactivatedPeriod }], [{ id: ids.record }], [draft],
  ]);
  await new PgEndodonticsDraftRepository(fake.uow, {}).create(
    { patientId: ids.patient, subjectId: ids.subject, groupId: ids.group, content: {} }, { id: ids.user, role: 'estudiante' });
  assert.equal(fake.calls.at(-1).params[3], reactivatedPeriod);
  assert.match(fake.calls[1].sql, /h\.revoked_at IS NULL/);
  assert.deepEqual(fake.calls[3].params[2], [reactivatedPeriod]);
});

test('an author can edit an existing draft after reactivation through a new active period and assignment', async () => {
  const reactivatedPeriod = '10000000-0000-4000-8000-000000000099';
  const updated = { ...draft, content: { revised: true }, version: '2' };
  const fake = transactionDouble([
    [draft], [{ id: 'student-profile' }], [{ id: reactivatedPeriod }], [{ id: ids.patient }],
    [{ student_habilitation_id: reactivatedPeriod }], [{ version: '1' }], [updated],
  ]);
  const result = await new PgEndodonticsDraftRepository(fake.uow, {}).edit(draft.id, '1', { revised: true }, { id: ids.user, role: 'estudiante' });
  assert.equal(result.version, '2');
  const update = fake.calls.at(-1);
  assert.match(update.sql, /UPDATE endodontics_drafts e/);
  assert.doesNotMatch(update.sql.split(' WHERE ')[0], /origin_student_habilitation_id/);
  assert.equal(fake.calls[2].sql.includes('revoked_at IS NULL'), true);
  assert.deepEqual(fake.calls[4].params[2], [reactivatedPeriod]);
});

test('a different student cannot edit an author-owned draft or mutate storage', async () => {
  const otherStudent = '10000000-0000-4000-8000-000000000099';
  const fake = transactionDouble([[]]);
  const repo = new PgEndodonticsDraftRepository(fake.uow, {});
  await assert.rejects(repo.edit(draft.id, '1', { changed: true }, { id: otherStudent, role: 'estudiante' }), /endodontics draft was not found/);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].sql, /author_id=\$2/);
  assert.deepEqual(fake.calls[0].params, [draft.id, otherStudent]);
});

test('edit locks and revalidates before version check/update; stale version cannot write', async () => {
  const fake = transactionDouble([
    [draft], [{ id: 'student-profile' }], [{ id: ids.period }], [{ id: ids.patient }],
    [{ student_habilitation_id: ids.period }], [{ version: '2' }],
  ]);
  const repo = new PgEndodonticsDraftRepository(fake.uow, {});
  await assert.rejects(repo.edit(draft.id, '1', { changed: true }, { id: ids.user, role: 'estudiante' }), /draft version changed/);
  assert.equal(fake.calls.some(x => /UPDATE\s+endodontics_drafts/.test(x.sql)), false);
  assert.ok(fake.calls.findIndex(x => x.sql.includes('patient_assignments')) < fake.calls.findIndex(x => x.sql.includes('FOR UPDATE') && x.sql.includes('endodontics_drafts')));
});
