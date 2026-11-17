import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createOralSurgeryDraftRouter } from '../../src/modules/oral-surgery-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { PgOralSurgeryDraftRepository } from '../../src/modules/oral-surgery-drafts/infrastructure/pg-oral-surgery-draft.repository.ts';

const user = '10000000-0000-4000-8000-000000000001';
const headers = (role = 'estudiante', permissions = 'oral-surgery-drafts:write,oral-surgery-drafts:read') =>
  ({ 'content-type': 'application/json', 'x-role': role, 'x-permissions': permissions });
const teacher = headers('teacher', 'oral-surgery-drafts:grade,oral-surgery-drafts:read');
const teacherActor = { id: user, role: 'teacher' };

// Fixed rubric from the paper form (S5): 12 scored keys whose maxima total 20.
const RUBRIC = [['hand_washing', 1], ['barrier_elements', 1], ['waste_disposal', 1], ['clinical_table_setup', 2],
  ['asepsis', 1], ['anamnesis_questionnaire', 3], ['anesthetic_technique', 2], ['sindesmotomy_elevators', 2],
  ['surgical_procedure', 3], ['curettage_suture', 2], ['record_and_equipment', 1], ['relationship', 1]];
const perfect = Object.fromEntries(RUBRIC.map(([key, max]) => [key, max]));
const below = { ...perfect, surgical_procedure: 0, anamnesis_questionnaire: 0 };
const fifteen = { ...perfect, surgical_procedure: 0, anamnesis_questionnaire: 2, relationship: 0 };

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

// Dispatches each statement to the first handler whose fragment it contains; unknown SQL fails loudly.
function fakeDb(handlers) {
  const log = [];
  return { log, async query(sql, params) {
    log.push({ sql, params });
    const handler = handlers.find(([fragment]) => sql.includes(fragment));
    if (!handler) throw new Error(`unexpected SQL: ${sql}`);
    return handler[1](params);
  } };
}
const repositoryFor = db => new PgOralSurgeryDraftRepository({ async withTransaction(run) { return run(db); } }, db);
const writes = db => db.log.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)).length;
const insertParams = db => db.log.find(({ sql }) => sql.includes('INSERT INTO oral_surgery_practical_evaluations')).params;

function gradeHandlers({ report = [{ status: 'closed' }], latest = [], periods = [{ id: 'teacher-period' }], draft = [{ origin_subject_id: 'subject', origin_group_id: 'group' }] } = {}) {
  return [
    ['FROM oral_surgery_drafts e WHERE e.id = $1', () => ({ rows: draft })],
    ['FROM teacher_academic_habilitations th', () => ({ rows: periods })],
    ['FROM oral_surgery_drafts WHERE id = $1 FOR UPDATE', () => ({ rows: [{ id: '1' }] })],
    ['FROM oral_surgery_operative_reports WHERE draft_id = $1 FOR SHARE', () => ({ rows: report })],
    ['FROM oral_surgery_practical_evaluations WHERE draft_id = $1 ORDER BY revision DESC LIMIT 1 FOR UPDATE', () => ({ rows: latest })],
    ['INSERT INTO oral_surgery_practical_evaluations', () => ({ rows: [{ revision: '1', total: 20, outcome: 'approved', reason: null,
      graded_by: user, teacher_habilitation_id: 'teacher-period', graded_at: new Date(0) }] })],
  ];
}

test('S5: grading accepts exactly the fixed 12-key rubric and rejects malformed items before any write', async () => {
  let graded = 0;
  const { relationship, ...missing } = perfect;
  await serve({ async gradePracticalEvaluation() { graded++; return {}; } }, async request => {
    const rejected = [
      [{ items: missing }, "missing practical item: relationship"],
      [{ items: { ...perfect, extra: 1 } }, 'unknown practical item: extra'],
      [{ items: { ...perfect, asepsis: '1' } }, 'asepsis must be an integer from 0 to 1'],
      [{ items: { ...perfect, surgical_procedure: 1.5 } }, 'surgical_procedure must be an integer from 0 to 3'],
      [{ items: { ...perfect, hand_washing: 2 } }, 'hand_washing must be an integer from 0 to 1'],
      [{ items: { ...perfect, curettage_suture: -1 } }, 'curettage_suture must be an integer from 0 to 2'],
      [{ items: perfect, total: 20 }, 'allowed fields: items'],
    ];
    for (const [body, message] of rejected) {
      assert.deepEqual(await request('POST', '/practical-evaluation', body, teacher),
        { status: 400, body: { error: { code: 'BAD_REQUEST', message } } }, message);
    }
    assert.equal(graded, 0);
    assert.deepEqual(await request('POST', '/practical-evaluation', { items: perfect }, teacher), { status: 201, body: {} });
    assert.equal(graded, 1);
  });
});

test('S4: only a teacher holding oral-surgery-drafts:grade reaches the grade repository', async () => {
  let calls = 0;
  const forbidden = message => ({ status: 403, body: { error: { code: 'FORBIDDEN', message } } });
  await serve({ async gradePracticalEvaluation() { calls++; return {}; } }, async request => {
    const body = { items: perfect };
    const grade = "Permission 'oral-surgery-drafts:grade' required";
    assert.deepEqual(await request('POST', '/practical-evaluation', body, headers('estudiante', 'oral-surgery-drafts:write,oral-surgery-drafts:read,oral-surgery-drafts:grade')),
      forbidden('teacher instructor role required'));
    assert.deepEqual(await request('POST', '/practical-evaluation', body, headers('admin', 'oral-surgery-drafts:grade')),
      forbidden('teacher instructor role required'));
    assert.deepEqual(await request('POST', '/practical-evaluation', body, headers('estudiante')), forbidden(grade));
    assert.deepEqual(await request('POST', '/practical-evaluation', body, headers('admin')), forbidden(grade));
    assert.deepEqual(await request('POST', '/practical-evaluation', body, headers('teacher', 'oral-surgery-drafts:read,oral-surgery-drafts:close')), forbidden(grade));
  });
  assert.equal(calls, 0);
});

test('S3: corrections require expected_revision and a non-empty reason of at most 4000 characters without NUL', async () => {
  let calls = 0;
  const invalid = { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'reason must be non-empty text of at most 4000 characters without NUL' } } };
  await serve({ async correctPracticalEvaluation() { calls++; return {}; } }, async request => {
    for (const reason of ['', '   ', 'x'.repeat(4001), 'bad\u0000reason']) {
      assert.deepEqual(await request('POST', '/practical-evaluation/corrections', { expected_revision: '1', reason, items: perfect }, teacher), invalid);
    }
    assert.equal((await request('POST', '/practical-evaluation/corrections', { reason: 'Loaded wrong item', items: perfect }, teacher)).status, 400);
    assert.equal(calls, 0);
    assert.deepEqual(await request('POST', '/practical-evaluation/corrections',
      { expected_revision: '1', reason: 'Loaded wrong item', items: perfect }, teacher), { status: 201, body: {} });
    assert.equal(calls, 1);
  });
});

test('S1/S4: initial grading locks teacher period, draft, closed report, then evaluation, and inserts revision 1 without UPDATE', async () => {
  const db = fakeDb(gradeHandlers());
  const row = await repositoryFor(db).gradePracticalEvaluation('1', perfect, teacherActor);
  assert.equal(row.revision, '1');
  const index = pattern => db.log.findIndex(({ sql }) => pattern.test(sql));
  const order = [/FOR UPDATE OF th/, /FROM oral_surgery_drafts WHERE id = \$1 FOR UPDATE/, /FOR SHARE/,
    /ORDER BY revision DESC LIMIT 1 FOR UPDATE/, /INSERT INTO oral_surgery_practical_evaluations/].map(index);
  assert.ok(order.every(position => position >= 0), 'every lock and the insert must run');
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
  const params = insertParams(db);
  assert.equal(params[1], '1');
  assert.equal(params[14], 20);
  assert.equal(params[15], 'approved');
  assert.equal(params[16], null);
  assert.equal(db.log.some(({ sql }) => /^\s*(UPDATE|DELETE)\b/i.test(sql)), false);
});

test('S2: the server computes the total and annuls below 15 while exactly 15 is approved', async () => {
  for (const [items, total, outcome] of [[below, 14, 'annulled'], [fifteen, 15, 'approved']]) {
    const db = fakeDb(gradeHandlers());
    await repositoryFor(db).gradePracticalEvaluation('1', items, teacherActor);
    assert.equal(insertParams(db)[14], total);
    assert.equal(insertParams(db)[15], outcome);
  }
});

test('S1: grading before the operative report is closed conflicts and writes nothing', async () => {
  for (const report of [[{ status: 'draft' }], []]) {
    const db = fakeDb(gradeHandlers({ report }));
    await assert.rejects(repositoryFor(db).gradePracticalEvaluation('1', perfect, teacherActor),
      error => error.statusCode === 409 && error.message === 'operative report must be closed before practical evaluation');
    assert.equal(writes(db), 0);
  }
});

test('S3: a second initial grade conflicts while the current revision exists', async () => {
  const db = fakeDb(gradeHandlers({ latest: [{ revision: '1' }] }));
  await assert.rejects(repositoryFor(db).gradePracticalEvaluation('1', perfect, teacherActor),
    error => error.statusCode === 409 && error.message === 'practical evaluation already exists; reload before grading');
  assert.equal(writes(db), 0);
});

test('S3: corrections append revision+1 with the mandatory reason and reject stale or missing revisions without writes', async () => {
  const correction = (latest, expected) => fakeDb(gradeHandlers({ latest }).map(([fragment, handler]) =>
    fragment === 'INSERT INTO oral_surgery_practical_evaluations' ? [fragment, params => ({ rows: [{ revision: params[1], total: 20,
      outcome: 'approved', reason: params[16], graded_by: user, teacher_habilitation_id: 'teacher-period', graded_at: new Date(0) }] })] : [fragment, handler]));
  for (const [latest, expected] of [[[{ revision: '2' }], '1'], [[], '1']]) {
    const db = correction(latest, expected);
    await assert.rejects(repositoryFor(db).correctPracticalEvaluation('1', expected, 'Loaded wrong item', perfect, teacherActor),
      error => error.statusCode === 409 && error.message === 'practical evaluation changed; reload before correcting');
    assert.equal(writes(db), 0);
  }
  const db = correction([{ revision: '2' }], '2');
  const row = await repositoryFor(db).correctPracticalEvaluation('1', '2', 'Loaded wrong item', below, teacherActor);
  assert.equal(row.revision, '3');
  assert.equal(insertParams(db)[1], '3');
  assert.equal(insertParams(db)[16], 'Loaded wrong item');
  assert.equal(insertParams(db)[14], 14);
});

test('S4: an unknown draft or a teacher without the origin habilitation gets the hidden 404 and no writes', async () => {
  const hidden = /^oral surgery draft was not found$/;
  for (const options of [{ periods: [] }, { draft: [] }]) {
    const db = fakeDb(gradeHandlers(options));
    await assert.rejects(repositoryFor(db).gradePracticalEvaluation('1', perfect, teacherActor),
      error => error.statusCode === 404 && hidden.test(error.message));
    assert.equal(writes(db), 0);
  }
});

const viewRow = fields => ({ draft_id: '1', evaluation_id: '5', revision: '1', hand_washing: 1, barrier_elements: 1,
  waste_disposal: 1, clinical_table_setup: 2, asepsis: 1, anamnesis_questionnaire: 3, anesthetic_technique: 2,
  sindesmotomy_elevators: 2, surgical_procedure: 3, curettage_suture: 2, record_and_equipment: 1, relationship: 1,
  total: 20, outcome: 'approved', reason: null, graded_by: 'grader', teacher_habilitation_id: 'teacher-period',
  graded_at: new Date(0), ...fields });

test('S6: students read only the current grade while teachers and admins also read revisions with reasons and actors', async () => {
  const rows = [viewRow({ revision: '1', total: 14, outcome: 'annulled' }),
    viewRow({ evaluation_id: '6', revision: '2', reason: 'Loaded wrong item', graded_at: new Date(1000) })];
  const db = fakeDb([['LEFT JOIN oral_surgery_practical_evaluations', () => ({ rows })]]);
  const repository = repositoryFor(db);
  const student = await repository.getPracticalEvaluation('1', { id: user, role: 'estudiante' });
  assert.deepEqual(Object.keys(student), ['current']);
  assert.deepEqual(Object.keys(student.current).sort(), ['graded_at', 'items', 'outcome', 'total']);
  assert.equal(student.current.total, 20);
  assert.equal(student.current.outcome, 'approved');
  assert.equal(JSON.stringify(student).includes('Loaded wrong item'), false);
  for (const role of ['teacher', 'admin']) {
    const view = await repository.getPracticalEvaluation('1', { id: user, role });
    assert.equal(view.current.revision, '2');
    assert.equal(view.current.reason, 'Loaded wrong item');
    assert.equal(view.history.length, 2);
    assert.equal(view.history[0].outcome, 'annulled');
    assert.equal(view.history[1].graded_by, 'grader');
    assert.equal(view.history[1].teacher_habilitation_id, 'teacher-period');
    assert.equal(view.history[1].graded_at, new Date(1000).toISOString());
  }
});

test('S6: a visible draft without a grade returns an explicit 404 and an inaccessible draft stays hidden', async () => {
  const withoutGrade = fakeDb([['LEFT JOIN oral_surgery_practical_evaluations', () => ({ rows: [viewRow({ evaluation_id: null, revision: null })] })]]);
  await assert.rejects(repositoryFor(withoutGrade).getPracticalEvaluation('1', { id: user, role: 'estudiante' }),
    error => error.statusCode === 404 && error.message === 'oral surgery practical evaluation was not found');
  const hidden = fakeDb([['LEFT JOIN oral_surgery_practical_evaluations', () => ({ rows: [] })]]);
  await assert.rejects(repositoryFor(hidden).getPracticalEvaluation('1', { id: user, role: 'estudiante' }),
    error => error.statusCode === 404 && error.message === 'oral surgery draft was not found');
});

test('S1/S2/S5/S7: practical evaluation schema is append-only with DB-enforced rubric bounds, total and outcome', () => {
  const schema = readFileSync('src/db/migrations/051_create_oral_surgery_practical_evaluations.sql', 'utf8');
  for (const [key, max] of RUBRIC) {
    assert.match(schema, new RegExp(`${key} SMALLINT NOT NULL CHECK \\(${key} BETWEEN 0 AND ${max}\\)`), key);
  }
  assert.match(schema, /total SMALLINT NOT NULL CHECK \(total BETWEEN 0 AND 20\)/);
  assert.match(schema, /CHECK \(total = hand_washing \+ barrier_elements \+ waste_disposal/);
  assert.match(schema, /outcome IN \('approved', 'annulled'\)/);
  assert.match(schema, /\(total >= 15 AND outcome = 'approved'\) OR \(total < 15 AND outcome = 'annulled'\)/);
  assert.match(schema, /\(revision = 1\) = \(reason IS NULL\)/);
  assert.match(schema, /UNIQUE \(draft_id, revision\)/);
  assert.match(schema, /BEFORE UPDATE ON oral_surgery_practical_evaluations/);
  assert.doesNotMatch(schema, /BEFORE DELETE|AFTER DELETE|ON DELETE CASCADE/);
});

test('S4/S7: the grade permission is enforced and seeded only for teachers', () => {
  const seed = readFileSync('src/db/migrations/052_seed_oral_surgery_grade_permission.sql', 'utf8');
  assert.match(seed, /\('oral-surgery-drafts:grade', true\)/);
  assert.match(seed, /\('teacher', 'oral-surgery-drafts:grade'\)/);
  assert.doesNotMatch(seed, /\('(admin|estudiante)', 'oral-surgery-drafts:grade'\)/);
});
