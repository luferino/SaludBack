import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect', JWT_SECRET: 'synthetic-kinesiology-secret',
  CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'kinesiology-test-key', JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3',
});
const [{ createApp }, { JwtTokenService }] = await Promise.all([
  import('../../src/app.ts'),
  import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
]);

const actor = '30000000-0000-4000-8000-000000000001';
const patient = '70000000-0000-4000-8000-000000000001';
const student = '30000000-0000-4000-8000-000000000011';
const period = '60000000-0000-4000-8000-000000000001';
const subject = '10000000-0000-4000-8000-000000000001';
const group = '20000000-0000-4000-8000-000000000001';
const otherSubject = '10000000-0000-4000-8000-000000000002';
const otherGroup = '20000000-0000-4000-8000-000000000002';
const grants = ['kinesiology-evaluations:read', 'kinesiology-evaluations:write', 'kinesiology-evaluations:submit'];

function fakePool() {
  const state = { queries: [], records: [], evaluations: [], consents: [], submissions: [], submissionStudies: [], correctionRequests: [], validationReviews: [], amendments: [], releases: 0, commits: 0, rollbacks: 0, transactionSnapshot: null,
    failAt: null, patients: [{ id: patient, documento: '12345678', nombres: 'Ana', apellidos: 'Lopez', fecha_nacimiento: '1990-05-10', email: 'ana@example.com', celular: '+5491100000000', sexo: 'F', direccion: 'Calle 1', created_by: actor, created_at: '2020-01-01T00:00:00Z' }],
    grants: { estudiante: [...grants], teacher: ['kinesiology-evaluations:read', 'kinesiology-evaluations:write', 'kinesiology-evaluations:verify-consent', 'kinesiology-evaluations:review'], admin: ['kinesiology-evaluations:read', 'kinesiology-evaluations:write'] },
    profiles: new Set([actor, '30000000-0000-4000-8000-000000000002']), periods: new Set([actor, '30000000-0000-4000-8000-000000000002']), assignments: new Set([actor, '30000000-0000-4000-8000-000000000002']), teachers: new Set(), teacherContexts: new Map(), currentPeriodIds: new Map(), hintMutation: null, transactionLockOrder: [], teacherPeriodLockIds: [], crossTeacherContexts: new Map() };
  function projectPatient(sql, row, user) {
    const projected = sql.includes('snapshot.patient_snapshot');
    if (projected) {
      for (const field of ['documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion']) assert.match(sql, new RegExp(`snapshot\\.patient_snapshot->>'${field}'`));
      const submission = state.submissions.filter(item => item.evaluation_id === row.id).at(-1);
      const cross = row.author_id !== user && submission;
      const amendmentLink = state.amendments.find(link => link.amendment_evaluation_id === row.id);
      return cross ? { ...row, amendment_of_evaluation_id: amendmentLink?.original_evaluation_id ?? null, content: submission.clinical_content, status: state.validationReviews.some(review => review.evaluation_id === row.id && review.submission_id === submission.id) ? 'validated' : 'submitted',
        created_at: submission.submitted_at, updated_at: submission.submitted_at,
        projected_submission_id: submission.id, projected_submission_ordinal: submission.ordinal,
        projected_submitted_by: submission.submitted_by, projected_submitted_at: submission.submitted_at,
        projected_age_at_admission: submission.age_at_admission, projected_consent: submission.verified_consent_snapshot,
        patient_documento: submission.patient_snapshot.documento, patient_nombres: submission.patient_snapshot.nombres,
        patient_apellidos: submission.patient_snapshot.apellidos, patient_fecha_nacimiento: submission.patient_snapshot.fecha_nacimiento,
        patient_email: submission.patient_snapshot.email, patient_celular: submission.patient_snapshot.celular,
        patient_sexo: submission.patient_snapshot.sexo, patient_direccion: submission.patient_snapshot.direccion } : { ...row,
        patient_documento: state.patients[0].documento, patient_nombres: state.patients[0].nombres,
        patient_apellidos: state.patients[0].apellidos, patient_fecha_nacimiento: state.patients[0].fecha_nacimiento,
        patient_email: state.patients[0].email, patient_celular: state.patients[0].celular,
        patient_sexo: state.patients[0].sexo, patient_direccion: state.patients[0].direccion,
        amendment_of_evaluation_id: amendmentLink?.original_evaluation_id ?? null };
    }
    for (const field of ['documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion']) assert.match(sql, new RegExp(`p\\.${field} AS patient_${field}`));
    const current = state.patients.find(item => item.id === row.patient_id);
    return current ? { ...row, patient_documento: current.documento, patient_nombres: current.nombres,
      patient_apellidos: current.apellidos, patient_fecha_nacimiento: current.fecha_nacimiento,
      patient_email: current.email, patient_celular: current.celular, patient_sexo: current.sexo,
      patient_direccion: current.direccion } : row;
  }
  async function query(sql, params = []) {
    state.queries.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
      if (sql === 'BEGIN') {
        state.transactionLockOrder = [];
        state.teacherPeriodLockIds = [];
        state.transactionSnapshot = structuredClone({ records: state.records, evaluations: state.evaluations, consents: state.consents, submissions: state.submissions, submissionStudies: state.submissionStudies, correctionRequests: state.correctionRequests, validationReviews: state.validationReviews, amendments: state.amendments });
      }
      if (sql === 'COMMIT') { state.commits++; state.transactionSnapshot = null; }
      if (sql === 'ROLLBACK') {
        state.rollbacks++;
        if (state.transactionSnapshot) Object.assign(state, structuredClone(state.transactionSnapshot));
        state.transactionSnapshot = null;
      }
      return { rows: [] };
    }
    if (sql.includes('FROM role_permissions')) return { rows: (state.grants[params[0]] ?? []).map(permission => ({ permission })) };
    if (sql.includes('FROM students WHERE user_id')) return { rows: state.profiles.has(params[0]) ? [{ id: params[0] === actor ? student : `${student}-other` }] : [] };
    if (sql.includes('FROM student_academic_habilitations')) {
      const user = params[0] === student ? actor : params[0] === `${student}-other` ? '30000000-0000-4000-8000-000000000002' : undefined;
      const contextMatches = user === actor
        ? params[1] === subject && params[2] === group
        : params[1] === otherSubject && params[2] === otherGroup;
      return { rows: user && contextMatches && state.periods.has(user)
        ? [{ id: state.currentPeriodIds.get(user) ?? (user === actor ? period : `${period}-other`), subject_id: params[1], academic_group_id: params[2], student_id: params[0] }]
        : [] };
    }
    if (sql.includes('FOR UPDATE')) {
      state.transactionLockOrder.push(sql.includes('teacher_academic_habilitations') ? 'teacher-period'
        : sql.includes('FROM patients') ? 'patient'
          : sql.includes('FROM kinesiology_evaluations e') ? 'evaluation'
            : sql.includes('FROM kinesiology_evaluation_submissions') ? 'submission' : 'other');
    }
    if (sql.trimStart().startsWith('SELECT t.id') && sql.includes('teacher_academic_habilitations')) {
      assert.match(sql, /SELECT t\.id/);
      assert.match(sql, /t\.user_id = \$1/);
      assert.match(sql, /th\.subject_id = \$2/);
      assert.match(sql, /th\.academic_group_id = \$3/);
      assert.match(sql, /th\.revoked_at IS NULL/);
      const configured = state.teacherContexts.get(params[0]);
      const contexts = configured
        ? configured.profile ? configured.contexts.filter(context => context.subject_id === params[1] && context.group_id === params[2] && !context.revoked_at) : []
        : state.teachers.has(params[0]) ? [{ subject_id: subject, group_id: group, id: `teacher-period-${params[0]}` }] : [];
      contexts.sort((left, right) => /^\d+$/.test(left.id) && /^\d+$/.test(right.id)
        ? Number(left.id) - Number(right.id) : String(left.id).localeCompare(String(right.id)));
      if (sql.includes('FOR UPDATE')) {
        state.teacherPeriodLockIds.push(...contexts.map(context => context.id));
        return { rows: contexts.map(context => ({ id: `teacher-profile-${params[0]}`, teacher_habilitation_id: context.id })) };
      }
      return { rows: contexts.map(() => ({ id: `teacher-profile-${params[0]}` })) };
    }
    if (sql.includes('FROM patients WHERE id')) return { rows: state.patients.filter(row => row.id === params[0]).map(row => ({
      id: row.id, documento: row.documento, nombres: row.nombres, apellidos: row.apellidos,
      fecha_nacimiento: row.fecha_nacimiento, email: row.email, celular: row.celular,
      sexo: row.sexo, direccion: row.direccion,
    })) };
    if (sql.includes('FROM patient_assignments')) {
      const user = params[1] === student ? actor : params[1] === `${student}-other` ? '30000000-0000-4000-8000-000000000002' : actor;
      return { rows: state.assignments.has(user) ? [{ id: '9007199254740993', patient_id: patient, student_habilitation_id: state.currentPeriodIds.get(user) ?? (user === actor ? period : `${period}-other`), subject_id: subject, academic_group_id: group, ended_at: null }] : [] };
    }
    const canRead = (row, user, sql) => {
      const originStudent = row.author_id === user && state.profiles.has(user) && state.periods.has(user) && state.assignments.has(user);
      const originTeacher = state.teachers.has(user);
      const hasSnapshot = state.submissions.some(item => item.evaluation_id === row.id);
      const crossStudent = hasSnapshot && state.profiles.has(user) && state.periods.has(user) && state.assignments.has(user);
      const crossTeacher = hasSnapshot && (state.crossTeacherContexts.get(user) ?? new Set()).has(`${row.patient_id}|${row.origin_subject_id}|${row.origin_group_id}`);
      if (sql.includes('snapshot.clinical_content')) {
        assert.match(sql, /a\.subject_id = sp\.subject_id/);
        assert.match(sql, /sp\.academic_group_id = th\.academic_group_id/);
        assert.match(sql, /a\.subject_id = th\.subject_id/);
      }
      return originStudent || originTeacher || (sql.includes('snapshot.clinical_content') && (crossStudent || crossTeacher));
    };
    if (sql.includes('FROM kinesiology_evaluations e') && sql.includes('WHERE e.id = $1')) {
      const row = state.evaluations.find(item => item.id === params[0]);
      if (sql.includes('FOR UPDATE')) return { rows: row ? [row] : [] };
      assert.equal(params[1], row?.author_id === params[1] ? actor : params[1]);
      return { rows: row && canRead(row, params[1], sql) ? [projectPatient(sql, row, params[1])] : [] };
    }
    if (sql.includes('FROM kinesiology_evaluations e') && sql.includes('WHERE e.patient_id = $2')) {
      const [requestActor, requestPatient, requestSubject, requestGroup] = params;
      assert.equal(requestActor, params[0]);
      return { rows: state.evaluations.filter(row => row.patient_id === requestPatient && canRead(row, requestActor, sql) && (!requestSubject || row.origin_subject_id === requestSubject) && (!requestGroup || row.origin_group_id === requestGroup)).map(row => projectPatient(sql, row, requestActor)) };
    }
    if (sql.includes('FROM kinesiology_evaluations WHERE id')) {
      const row = state.evaluations.find(item => item.id === params[0]);
      const hint = row ? structuredClone(row) : null;
      if (row && state.hintMutation) { state.hintMutation(row); state.hintMutation = null; }
      return { rows: hint ? [hint] : [] };
    }
    if (sql.includes("SET status = 'validated'")) {
      const row = state.evaluations.find(item => item.id === params[0]);
      if (!row || row.status !== 'submitted') return { rows: [] };
      row.status = 'validated';
      if (state.failAt === 'after-validation-update') throw new Error('synthetic validation update failure');
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes("SET status = 'submitted'")) {
      const row = state.evaluations.find(item => item.id === params[0]);
      if (!row || row.status !== 'draft') return { rows: [] };
      row.status = 'submitted';
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('UPDATE kinesiology_evaluations SET content') && sql.includes('correction_from_submission_id')) {
      const row = state.evaluations.find(item => item.id === params[0]);
      if (!row || row.status !== 'submitted' || state.failAt === 'no-correction-draft-update') return { rows: [] };
      row.content = JSON.parse(params[1]); row.status = 'draft'; row.correction_from_submission_id = params[2];
      row.updated_at = new Date('2026-02-01T00:00:00Z');
      if (state.failAt === 'after-correction-draft') throw new Error('synthetic correction draft failure');
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('UPDATE kinesiology_evaluations')) {
      const row = state.evaluations.find(item => item.id === params[0]);
      if (!row || row.status !== 'draft') return { rows: [] };
      row.content = JSON.parse(params[1]); row.updated_at = new Date('2026-01-02T00:00:00Z');
      if (state.failAt === 'after-edit-update') throw new Error('synthetic edit failure');
      return { rows: [row] };
    }
    if (sql.includes('FROM kinesiology_evaluation_amendment_links link') && sql.includes('verified_consent_snapshot') && sql.includes('WHERE link.amendment_evaluation_id = $1')) {
      const link = state.amendments.find(row => row.amendment_evaluation_id === params[0]);
      const source = link && state.submissions.filter(row => row.evaluation_id === link.original_evaluation_id).at(-1)?.verified_consent_snapshot;
      return { rows: source ? [{ id: source.id, paper_signature_date: source.paper_signature_date, verified_by: source.verified_by, verified_at: source.verified_at }] : [] };
    }
    if (sql.includes('FROM kinesiology_consent_attestations')) return { rows: state.consents.filter(row => row.evaluation_id === params[0]).slice(-1) };
    if (sql.includes('INSERT INTO kinesiology_evaluation_submissions')) {
      const row = { id: String(9007199254741001n + BigInt(state.submissions.length)), evaluation_id: params[0], ordinal: String(state.submissions.filter(item => item.evaluation_id === params[0]).length + 1), submitted_by: params[1],
        clinical_content: JSON.parse(params[2]), patient_snapshot: JSON.parse(params[3]), age_at_admission: params[4],
        verified_consent_snapshot: JSON.parse(params[5]), submitted_at: '2026-01-04T00:00:00.000Z' };
      state.submissions.push(row);
      if (state.failAt === 'after-submission-insert') throw new Error('synthetic submission failure');
      return { rows: [{ id: row.id, ordinal: row.ordinal, submitted_at: row.submitted_at }] };
    }
    if (sql.includes('INSERT INTO kinesiology_evaluation_submission_studies')) {
      state.submissionStudies.push({ submission_id: params[0], ordinal: params[1], type: params[2], description: params[3], date: params[4] });
      if (state.failAt === 'after-study-insert') throw new Error('synthetic study failure');
      return { rows: [] };
    }
    if (sql.includes('FROM kinesiology_evaluation_submissions s') && sql.includes('JOIN kinesiology_evaluation_validation_reviews review')) {
      const latest = state.submissions.filter(row => row.evaluation_id === params[0]).at(-1);
      return { rows: latest && state.validationReviews.some(row => row.evaluation_id === params[0] && row.submission_id === latest.id)
        ? [{ id: latest.id, clinical_content: latest.clinical_content }] : [] };
    }
    if (sql.includes('FROM kinesiology_evaluation_submissions') && sql.includes('WHERE id = $1 AND evaluation_id = $2')) {
      return { rows: state.submissions.filter(row => row.id === params[0] && row.evaluation_id === params[1]).map(row => ({ id: row.id, clinical_content: row.clinical_content })) };
    }
    if (sql.includes('FROM kinesiology_evaluation_submissions') && sql.includes('ORDER BY ordinal DESC LIMIT 1')) {
      const latest = state.submissions.filter(row => row.evaluation_id === params[0]).at(-1);
      return { rows: latest ? [{ id: latest.id }] : [] };
    }
    if (sql.includes('FROM kinesiology_evaluation_submissions s')) {
      const evaluation = state.evaluations.find(row => row.id === params[0]);
      const user = params[1];
      const origin = evaluation && (evaluation.author_id === user && state.profiles.has(user) && state.periods.has(user) && state.assignments.has(user) || state.teachers.has(user));
      const cross = evaluation && state.submissions.some(row => row.evaluation_id === evaluation.id) && user && state.profiles.has(user) && state.periods.has(user) && state.assignments.has(user);
      assert.match(sql, /latest\.ordinal DESC LIMIT 1/);
      const versions = state.submissions.filter(row => row.evaluation_id === params[0]);
      const allowed = origin ? versions : cross ? versions.slice(-1) : [];
      const amendmentLink = state.amendments.find(link => link.amendment_evaluation_id === params[0]);
      return { rows: allowed.map(row => ({
        id: row.id, evaluation_id: row.evaluation_id, amendment_of_evaluation_id: amendmentLink?.original_evaluation_id ?? null, ordinal: row.ordinal, submitted_by: row.submitted_by,
        submitted_at: row.submitted_at, clinical_content: row.clinical_content,
        validation_status: state.validationReviews.some(review => review.evaluation_id === row.evaluation_id && review.submission_id === row.id) ? 'validated' : 'pending_validation',
        patient: row.patient_snapshot, age_at_admission: row.age_at_admission, consent: row.verified_consent_snapshot,
        studies: state.submissionStudies.filter(study => study.submission_id === row.id).map(({ type, description, date }) => ({ type, description, date })),
      })) };
    }
    if (sql.includes('INSERT INTO kinesiology_evaluation_amendment_links')) {
      state.amendments.push({ original_evaluation_id: params[0], amendment_evaluation_id: params[1], created_by: params[5] });
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO kinesiology_evaluation_validation_reviews')) {
      const row = { id: String(9007199254741200n + BigInt(state.validationReviews.length)), evaluation_id: params[0], submission_id: params[1], reviewed_by: params[2], teacher_habilitation_id: params[3], reviewed_at: '2026-02-01T00:00:00.000Z' };
      state.validationReviews.push(row);
      if (state.failAt === 'after-validation-review') throw new Error('synthetic validation review failure');
      return { rows: [{ id: row.id, reviewed_at: row.reviewed_at }] };
    }
    if (sql.includes('FROM kinesiology_evaluation_correction_requests')) return { rows: state.correctionRequests.filter(row => row.evaluation_id === params[0]).map(({ submission_id, reason, reviewed_by, requested_at }) => ({ submission_id, reason, reviewed_by, requested_at })) };
    if (sql.includes('INSERT INTO kinesiology_evaluation_correction_requests')) {
      const row = { id: String(9007199254741100n + BigInt(state.correctionRequests.length)), evaluation_id: params[0], submission_id: params[1], reason: params[2], reviewed_by: params[3], requested_at: '2026-02-01T00:00:00.000Z' };
      state.correctionRequests.push(row);
      if (state.failAt === 'after-correction-event') throw new Error('synthetic correction event failure');
      return { rows: [{ id: row.id, requested_at: row.requested_at }] };
    }
    if (sql.includes('FROM kinesiology_evaluation_submission_studies')) return { rows: state.submissionStudies.filter(row => row.submission_id === params[0]).map(({ type, description, date }) => ({ type, description, date })) };
    if (sql.includes('INSERT INTO kinesiology_consent_attestations')) {
      const row = { id: String(9007199254740995n + BigInt(state.consents.length)), evaluation_id: params[0], paper_signature_date: params[1], verified_by: params[2], teacher_habilitation_id: params[3], verified_at: '2026-01-03T00:00:00.000Z' };
      state.consents.push(row);
      if (state.failAt === 'after-consent-insert') throw new Error('synthetic consent failure');
      return { rows: [{ id: row.id, paper_signature_date: row.paper_signature_date, verified_by: row.verified_by, verified_at: row.verified_at }] };
    }
    if (sql.includes('FROM clinical_records')) return { rows: state.records.filter(row => row.patient_id === params[0]) };
    if (sql.includes('INSERT INTO clinical_records')) {
      const existing = state.records.find(item => item.patient_id === params[0]);
      if (existing) return { rows: [] };
      const row = { id: '9007199254740993', patient_id: params[0], created_by: params[1], created_at: '2026-01-01T00:00:00Z' };
      state.records.push(row);
      return { rows: [row] };
    }
    if (sql.includes('SELECT id::text AS id FROM clinical_records')) return { rows: state.records.filter(row => row.patient_id === params[0]).map(row => ({ id: row.id })) };
    if (sql.includes('INSERT INTO kinesiology_evaluations')) {
      if (state.failAt === 'after-history-insert') throw new Error('synthetic evaluation insert failure');
      const row = { id: String(9007199254740994n + BigInt(state.evaluations.length)), clinical_record_id: '9007199254740993', patient_id: params[1], author_id: params[2], origin_student_habilitation_id: params[3], origin_subject_id: params[4], origin_group_id: params[5], content: JSON.parse(params[6]), status: 'draft', created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-01T00:00:00Z') };
      state.evaluations.push(row);
      return { rows: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { state, query, async connect() { return { query, release() { state.releases++; } }; } };
}

async function withServer(pool, run) {
  const server = createServer(createApp(pool));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const tokens = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: process.env.JWT_SECRET_KID, previousSecrets: [], expiresIn: '1h' });
  try { await run(`http://127.0.0.1:${server.address().port}`, tokens); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

async function bearer(tokens, sub = actor, permissions = grants, role = 'estudiante') {
  return tokens.sign({ role, ...(sub === null ? {} : { sub }), username: role, permissions });
}
async function call(base, token, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function createSubmitted(pool, base, tokens, teacher, content = {
  admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'History',
  objectives: 'Goal', proposed_treatment: 'Plan',
}) {
  const author = await bearer(tokens);
  const created = await call(base, author, 'POST', '/kinesiology-evaluations', {
    patient_id: patient, subject_id: subject, academic_group_id: group, content,
  });
  assert.equal(created.status, 201);
  const evaluationId = (await created.json()).id;
  pool.state.teachers.add(teacher);
  const consent = await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher'),
    'POST', `/kinesiology-evaluations/${evaluationId}/consent`, { paper_signature_date: '2026-01-01' });
  assert.equal(consent.status, 201);
  const submitted = await call(base, author, 'POST', `/kinesiology-evaluations/${evaluationId}/submissions`, {});
  assert.equal(submitted.status, 201);
  return { author, evaluationId, submissionId: (await submitted.json()).id };
}

test('a current student can create an explicit amendment from a validated original', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000003';
    const { evaluationId, submissionId } = await createSubmitted(pool, base, tokens, teacher, {
      admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'Validated history',
      objectives: 'Goal', proposed_treatment: 'Plan',
    });
    const teacherToken = await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher');
    assert.equal((await call(base, teacherToken, 'POST', `/kinesiology-evaluations/${evaluationId}/validations`, { submission_id: submissionId })).status, 201);
    const originalBefore = structuredClone({ evaluation: pool.state.evaluations[0], submission: pool.state.submissions[0], review: pool.state.validationReviews[0] });
    const beforeParentRace = structuredClone({ evaluations: pool.state.evaluations, links: pool.state.amendments, submissions: pool.state.submissions });
    pool.state.hintMutation = row => { row.patient_id = '70000000-0000-4000-8000-000000000099'; };
    const racedParent = await call(base, await bearer(tokens), 'POST', `/kinesiology-evaluations/${evaluationId}/amendments`, {});
    assert.equal(racedParent.status, 404);
    assert.deepEqual(await racedParent.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    assert.deepEqual({ evaluations: pool.state.evaluations, links: pool.state.amendments, submissions: pool.state.submissions }, beforeParentRace);
    const response = await call(base, await bearer(tokens), 'POST', `/kinesiology-evaluations/${evaluationId}/amendments`, {});
    assert.equal(response.status, 201);
    const amendment = await response.json();
    assert.equal(amendment.status, 'draft');
    assert.equal(amendment.patient_id, patient);
    assert.equal(amendment.content.illness_history, 'Validated history');
    assert.deepEqual(pool.state.transactionLockOrder, ['patient', 'other', 'evaluation', 'submission']);
    assert.match(pool.state.queries.findLast(query => query.sql.includes('FROM student_academic_habilitations') && query.sql.includes('ORDER BY id FOR UPDATE')).sql,
      /ORDER BY id FOR UPDATE/);
    assert.deepEqual({ evaluation: pool.state.evaluations[0], submission: pool.state.submissions[0], review: pool.state.validationReviews[0] }, originalBefore);
    assert.deepEqual(pool.state.amendments, [{ original_evaluation_id: evaluationId, amendment_evaluation_id: amendment.id, created_by: actor }]);
    const detail = await call(base, await bearer(tokens), 'GET', `/kinesiology-evaluations/${amendment.id}`);
    assert.equal((await detail.json()).amendment_of_evaluation_id, evaluationId);
    const amendmentToken = await bearer(tokens);
    const emptyHistory = await call(base, amendmentToken, 'GET', `/kinesiology-evaluations/${amendment.id}/submissions`);
    assert.deepEqual(await emptyHistory.json(), { evaluation_id: amendment.id, amendment_of_evaluation_id: evaluationId, items: [] });
    const submitted = await call(base, amendmentToken, 'POST', `/kinesiology-evaluations/${amendment.id}/submissions`, {});
    assert.equal(submitted.status, 201);
    const version = await submitted.json();
    assert.equal(version.consent.id, pool.state.submissions[0].verified_consent_snapshot.id);
    assert.equal(version.clinical_content.illness_history, 'Validated history');
    const correction = await call(base, teacherToken, 'POST', `/kinesiology-evaluations/${amendment.id}/corrections`,
      { submission_id: version.id, reason: 'Please update the amendment.' });
    assert.equal(correction.status, 201);
    const edited = await call(base, amendmentToken, 'PATCH', `/kinesiology-evaluations/${amendment.id}`,
      { content: { ...version.clinical_content, illness_history: 'Amended history' } });
    assert.equal(edited.status, 200);
    const resubmitted = await call(base, amendmentToken, 'POST', `/kinesiology-evaluations/${amendment.id}/submissions`, {});
    assert.equal(resubmitted.status, 201);
    const resubmittedVersion = await resubmitted.json();
    assert.equal(resubmittedVersion.ordinal, '2');
    assert.equal(resubmittedVersion.consent.id, version.consent.id);
    const validation = await call(base, teacherToken, 'POST', `/kinesiology-evaluations/${amendment.id}/validations`, { submission_id: resubmittedVersion.id });
    assert.equal(validation.status, 201);
    assert.equal((await validation.json()).submission_id, resubmittedVersion.id);
    assert.deepEqual({ evaluation: pool.state.evaluations[0], submission: pool.state.submissions[0], review: pool.state.validationReviews[0] }, originalBefore);
    const amendmentHistory = await call(base, amendmentToken, 'GET', `/kinesiology-evaluations/${amendment.id}/submissions`);
    const historyBody = await amendmentHistory.json();
    assert.equal(historyBody.amendment_of_evaluation_id, evaluationId);
    assert.deepEqual(historyBody.items.map(item => item.id), [version.id, resubmittedVersion.id]);
  });
});

test('amendment creation rejects unvalidated, hidden, malformed, spoofed and stale-grant requests without mutation', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group, content: { illness_history: 'draft source' },
    });
    const id = (await created.json()).id;
    const before = structuredClone({ records: pool.state.records, evaluations: pool.state.evaluations,
      submissions: pool.state.submissions, links: pool.state.amendments, commits: pool.state.commits });
    const spoofed = await call(base, author, 'POST', `/kinesiology-evaluations/${id}/amendments`, { author_id: actor });
    assert.equal(spoofed.status, 400);
    assert.deepEqual(await spoofed.json(), { error: { code: 'BAD_REQUEST', message: 'body must be an empty object' } });
    const unvalidated = await call(base, author, 'POST', `/kinesiology-evaluations/${id}/amendments`, {});
    assert.equal(unvalidated.status, 409);
    assert.deepEqual(await unvalidated.json(), { error: { code: 'CONFLICT', message: 'only a validated evaluation can be amended' } });
    const foreign = await call(base, await bearer(tokens, '30000000-0000-4000-8000-000000000002'), 'POST', `/kinesiology-evaluations/${id}/amendments`, {});
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const malformed = await call(base, author, 'POST', '/kinesiology-evaluations/01/amendments', {});
    assert.equal(malformed.status, 400);
    const previousGrant = pool.state.grants.estudiante;
    pool.state.grants.estudiante = previousGrant.filter(permission => permission !== 'kinesiology-evaluations:write');
    const staleGrant = await call(base, author, 'POST', `/kinesiology-evaluations/${id}/amendments`, {});
    assert.equal(staleGrant.status, 403);
    pool.state.grants.estudiante = previousGrant;
    assert.deepEqual({ records: pool.state.records, evaluations: pool.state.evaluations,
      submissions: pool.state.submissions, links: pool.state.amendments, commits: pool.state.commits }, before);
  });
});

test('migration 026 preserves restrictive, lossless amendment links matching the original patient and context', () => {
  const sql = readFileSync(new URL('../../src/db/migrations/026_create_kinesiology_amendment_links.sql', import.meta.url), 'utf8');
  assert.match(sql, /id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY/);
  assert.match(sql, /original_evaluation_id BIGINT NOT NULL/);
  assert.match(sql, /amendment_evaluation_id BIGINT NOT NULL UNIQUE/);
  assert.match(sql, /ON DELETE RESTRICT/g);
  assert.match(sql, /FOREIGN KEY \(original_evaluation_id, patient_id, origin_subject_id, origin_group_id\)/);
  assert.match(sql, /FOREIGN KEY \(amendment_evaluation_id, patient_id, origin_subject_id, origin_group_id\)/);
  assert.match(sql, /CHECK \(original_evaluation_id <> amendment_evaluation_id\)/);
});

test('submission history preserves private and missing 404 while an accessible draft has empty history', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const outsiderId = '30000000-0000-4000-8000-000000000002';
    const outsider = await bearer(tokens, outsiderId);
    const content = { admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'History', objectives: 'Goal', proposed_treatment: 'Plan' };
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
    assert.equal(created.status, 201);
    const id = (await created.json()).id;
    const business = () => structuredClone({ records: pool.state.records, evaluations: pool.state.evaluations, consents: pool.state.consents, submissions: pool.state.submissions, studies: pool.state.submissionStudies, commits: pool.state.commits, rollbacks: pool.state.rollbacks, releases: pool.state.releases });
    const denied = async (token, target) => {
      const before = business();
      const response = await call(base, token, 'GET', `/kinesiology-evaluations/${target}/submissions`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      assert.deepEqual(business(), before);
    };
    const before = business();
    const empty = await call(base, author, 'GET', `/kinesiology-evaluations/${id}/submissions`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { evaluation_id: id, items: [] });
    assert.deepEqual(business(), before);
    await denied(author, '9007199254740999');
    await denied(outsider, id);
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    assert.equal((await call(base, await bearer(tokens, teacher, [], 'teacher'), 'POST', `/kinesiology-evaluations/${id}/consent`, { paper_signature_date: '2026-01-01' })).status, 201);
    assert.equal((await call(base, author, 'POST', `/kinesiology-evaluations/${id}/submissions`, {})).status, 201);
    pool.state.assignments.delete(outsiderId);
    await denied(outsider, id);
    pool.state.periods.delete(actor);
    await denied(author, id);
  });
});

test('a different student with current patient access reads only the last submitted snapshot', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const content = { admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'submitted prose', objectives: 'Goal', proposed_treatment: 'Plan', studies: [{ type: 'image', description: 'frozen study' }] };
    const authorToken = await bearer(tokens);
    await call(base, authorToken, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
    const originTeacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(originTeacher);
    await call(base, await bearer(tokens, originTeacher, ['kinesiology-evaluations:verify-consent'], 'teacher'), 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-01-01' });
    assert.equal((await call(base, authorToken, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {})).status, 201);
    const latest = structuredClone(pool.state.submissions[0]);
    latest.id = '9007199254741002'; latest.ordinal = '2'; latest.submitted_at = '2026-01-05T00:00:00.000Z';
    latest.clinical_content.illness_history = 'latest submitted prose';
    latest.clinical_content.studies = [{ type: 'image', description: 'latest study', date: null }];
    latest.patient_snapshot.nombres = 'Snapshot name 2';
    latest.verified_consent_snapshot.paper_signature_date = '2026-01-02';
    pool.state.submissions.push(latest);
    pool.state.submissionStudies.push({ submission_id: latest.id, type: 'image', description: 'latest study', date: null });
    const crossStudent = await bearer(tokens, '30000000-0000-4000-8000-000000000002');
    pool.state.evaluations[0].content = { illness_history: 'unsubmitted working correction' };
    pool.state.evaluations[0].status = 'draft';
    pool.state.evaluations[0].updated_at = new Date('2026-02-01T00:00:00Z');
    pool.state.patients[0].nombres = 'Changed after submission';
    pool.state.consents.push({ id: '9007199254741010', evaluation_id: '9007199254740994', paper_signature_date: '2026-02-01', verified_by: originTeacher, verified_at: '2026-02-01T00:00:00.000Z' });
    const beforeReads = { records: structuredClone(pool.state.records), evaluations: structuredClone(pool.state.evaluations), submissions: structuredClone(pool.state.submissions), commits: pool.state.commits };
    const detail = await call(base, crossStudent, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.equal(detail.status, 200);
    const projected = await detail.json();
    assert.deepEqual(projected.content, latest.clinical_content);
    assert.equal(projected.status, 'submitted');
    assert.equal(projected.validation_status, 'pending_validation');
    assert.equal(projected.patient.nombres, 'Snapshot name 2');
    assert.deepEqual(projected.consent, latest.verified_consent_snapshot);
    assert.equal(projected.submission_id, latest.id);
    assert.equal(projected.updated_at, latest.submitted_at);
    const listing = await call(base, crossStudent, 'GET', `/kinesiology-evaluations?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`);
    assert.equal(listing.status, 200);
    assert.deepEqual((await listing.json()).items, [projected]);
    const history = await call(base, crossStudent, 'GET', '/kinesiology-evaluations/9007199254740994/submissions');
    assert.equal(history.status, 200);
    assert.deepEqual((await history.json()).items.map(item => item.id), [latest.id]);
    const authorHistory = await call(base, authorToken, 'GET', '/kinesiology-evaluations/9007199254740994/submissions');
    assert.deepEqual((await authorHistory.json()).items.map(item => item.id), ['9007199254741001', latest.id]);
    const missing = await call(base, crossStudent, 'GET', '/kinesiology-evaluations/9007199254740999');
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    pool.state.assignments.delete('30000000-0000-4000-8000-000000000002');
    const revoked = await call(base, crossStudent, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.deepEqual({ status: revoked.status, body: await revoked.json() }, { status: 404, body: missingBody });
    assert.deepEqual((await (await call(base, crossStudent, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).json()).items, []);
    const revokedHistory = await call(base, crossStudent, 'GET', '/kinesiology-evaluations/9007199254740994/submissions');
    assert.equal(revokedHistory.status, 404);
    assert.deepEqual(await revokedHistory.json(), missingBody);
    pool.state.assignments.add('30000000-0000-4000-8000-000000000002');
    const oldReadGrant = pool.state.grants.estudiante;
    pool.state.grants.estudiante = oldReadGrant.filter(permission => permission !== 'kinesiology-evaluations:read');
    assert.equal((await call(base, crossStudent, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 403);
    pool.state.grants.estudiante = oldReadGrant;
    const crossTeacher = '30000000-0000-4000-8000-000000000005';
    pool.state.crossTeacherContexts.set(crossTeacher, new Set([`${patient}|${subject}|${group}`]));
    const crossTeacherToken = await bearer(tokens, crossTeacher, ['kinesiology-evaluations:read'], 'teacher');
    assert.equal((await call(base, crossTeacherToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 200);
    assert.equal((await call(base, crossTeacherToken, 'GET', '/kinesiology-evaluations/9007199254740994/consent')).status, 404);
    pool.state.crossTeacherContexts.set(crossTeacher, new Set());
    assert.equal((await call(base, crossTeacherToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.deepEqual({ records: pool.state.records, evaluations: pool.state.evaluations, submissions: pool.state.submissions, commits: pool.state.commits }, beforeReads);
    assert.equal(pool.state.records.length, 1);
    assert.equal(pool.state.commits, 3);
  });
});

test('a different student with a current assignment cannot read another student\'s draft', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const otherActor = '30000000-0000-4000-8000-000000000002';
    const otherToken = await bearer(tokens, otherActor);
    const response = await call(base, otherToken, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const listing = await call(base, otherToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
    assert.equal(listing.status, 200);
    assert.deepEqual(await listing.json(), { items: [] });
  });
});

test('draft content keeps DIU distinct, preserves trivalent antecedents, and rejects invalid calendar dates', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const good = await call(base, auth, 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group,
      content: { antecedents: { diu: null, hta: false }, admission_date: null,
        studies: [{ type: 'x-ray', description: 'report', date: null }] },
    });
    assert.equal(good.status, 201);
    assert.deepEqual((await good.json()).content, { admission_date: null, antecedents: { hta: false, diu: null }, studies: [{ type: 'x-ray', description: 'report', date: null }] });
    const before = JSON.stringify(pool.state.evaluations);
    for (const content of [
      { admission_date: '2025-02-30' },
      { studies: [{ type: 'x-ray', description: 'report', date: '2025-02-30' }] },
      { antecedentes: { diu: true } },
    ]) {
      const response = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
      assert.equal(response.status, 400);
      assert.deepEqual(JSON.parse(JSON.stringify(pool.state.evaluations)), JSON.parse(before));
    }
  });
});

test('list requires patient scope and honors supplied subject/group filters', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    let response = await call(base, auth, 'GET', `/kinesiology-evaluations?subject_id=${subject}`);
    assert.equal(response.status, 400);
    assert.equal(pool.state.queries.some(query => query.sql.includes('FROM kinesiology_evaluations e')), false);
    response = await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`);
    assert.equal(response.status, 200);
    const query = pool.state.queries.findLast(item => item.sql.includes('FROM kinesiology_evaluations e') && item.sql.includes('WHERE e.patient_id = $2'));
    assert.match(query.sql, /e\.origin_subject_id = \$3/);
    assert.match(query.sql, /e\.origin_group_id = \$4/);
  });
});

test('foreign PATCH hides drafts without origin visibility and matches missing-target 404 without mutation', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: { illness_history: 'private prose' } });
    assert.equal(created.status, 201);
    const foreignActor = '30000000-0000-4000-8000-000000000002';
    const foreignToken = await bearer(tokens, foreignActor);
    const before = structuredClone(pool.state.evaluations);
    const beforeCommits = pool.state.commits;
    const beforeReleases = pool.state.releases;
    const denied = await call(base, foreignToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'intrusion' } });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const missing = await call(base, foreignToken, 'PATCH', '/kinesiology-evaluations/9007199254740995', { content: { illness_history: 'intrusion' } });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    assert.deepEqual(pool.state.evaluations, before);
    assert.equal(pool.state.commits, beforeCommits);
    assert.equal(pool.state.releases, beforeReleases + 2);
  });
});

test('author can edit a current-origin draft; a different student cannot', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const before = JSON.stringify(pool.state.evaluations[0]);
    const denied = await call(base, await bearer(tokens, '30000000-0000-4000-8000-000000000002'), 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'no' } });
    assert.equal(denied.status, 404);
    assert.equal(JSON.stringify(pool.state.evaluations[0]), before);
    const updated = await call(base, author, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'reported' } });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).content.illness_history, 'reported');
    assert.equal(pool.state.commits, 2);
    assert.equal(pool.state.releases, 3);
  });
});

test('student can create a draft through the public app and IDs remain lossless strings', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const response = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(response.status, 201);
    const output = await response.json();
    assert.equal(output.id, '9007199254740994');
    assert.equal(output.clinical_record_id, '9007199254740993');
    assert.equal(output.status, 'draft');
  });
  assert.equal(pool.state.records.length, 1);
  assert.equal(pool.state.evaluations.length, 1);
  assert.equal(pool.state.commits, 1);
  assert.equal(pool.state.releases, 1);
});

test('public endpoints reject unauthenticated and malformed-subject actors before writes', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const missing = await call(base, null, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
    const malformed = await call(base, await bearer(tokens, 'not-a-uuid'), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(malformed.status, 401);
    assert.deepEqual(await malformed.json(), { error: { code: 'UNAUTHORIZED', message: 'A verified UUID actor is required' } });
    assert.equal(pool.state.records.length, 0);
    assert.equal(pool.state.evaluations.length, 0);
    assert.equal(pool.state.commits, 0);
    assert.equal(pool.state.releases, 0);
  });
});

test('body-supplied authorship and audit fields are rejected without mutation', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const response = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group, author_id: actor,
      reviewer_id: actor, created_by: actor, audit: { actor_id: actor }, content: {},
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: 'body may contain only patient_id, subject_id, academic_group_id and content' } });
    assert.equal(pool.state.records.length, 0);
    assert.equal(pool.state.evaluations.length, 0);
    assert.equal(pool.state.commits, 0);
    assert.equal(pool.state.rollbacks, 0);
    assert.equal(pool.state.releases, 0);
  });
});

test('R1 fresh role grants override unchanged token claims for reads and writes', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const created = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const saved = structuredClone(pool.state.evaluations);
    const savedRecords = structuredClone(pool.state.records);
    const commits = pool.state.commits;
    pool.state.grants.estudiante = pool.state.grants.estudiante.filter(permission => permission !== 'kinesiology-evaluations:read');
    for (const path of ['/kinesiology-evaluations/9007199254740994', `/kinesiology-evaluations?patient_id=${patient}`]) {
      const response = await call(base, auth, 'GET', path);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evaluations:read' required" } });
    }
    pool.state.grants.estudiante = grants.filter(permission => permission !== 'kinesiology-evaluations:write');
    for (const [method, path, body] of [
      ['POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} }],
      ['PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'denied' } }],
    ]) {
      const response = await call(base, auth, method, path, body);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evaluations:write' required" } });
    }
    assert.deepEqual(pool.state.evaluations, saved);
    assert.deepEqual(pool.state.records, savedRecords);
    assert.equal(pool.state.commits, commits);
  });
});

test('R2 student detail/list/edit require linked profile and current origin assignment', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const saved = structuredClone(pool.state.evaluations);
    const savedRecords = structuredClone(pool.state.records);
    const commits = pool.state.commits;
    for (const [index, change] of [
      () => pool.state.profiles.delete(actor),
      () => { pool.state.profiles.add(actor); pool.state.periods.delete(actor); },
      () => { pool.state.periods.add(actor); pool.state.assignments.delete(actor); },
    ].entries()) {
      change();
      const detail = await call(base, auth, 'GET', '/kinesiology-evaluations/9007199254740994');
      assert.equal(detail.status, 404);
      assert.deepEqual(await detail.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      const listing = await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
      assert.equal(listing.status, 200);
      assert.deepEqual(await listing.json(), { items: [] });
      const update = await call(base, auth, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'denied' } });
      assert.equal(update.status, index === 2 ? 404 : 403);
      assert.deepEqual(await update.json(), index === 2
        ? { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } }
        : { error: { code: 'FORBIDDEN', message: 'an active patient assignment is required' } });
      assert.deepEqual(pool.state.evaluations, saved);
      assert.deepEqual(pool.state.records, savedRecords);
      assert.equal(pool.state.commits, commits);
    }
  });
});

test('R3 origin teacher is read-only; other students and administrators cannot bypass draft privacy', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const saved = structuredClone(pool.state.evaluations);
    const savedRecords = structuredClone(pool.state.records);
    const commits = pool.state.commits;
    const releases = pool.state.releases;
    const rollbacks = pool.state.rollbacks;
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    const teacherToken = await bearer(tokens, teacher, grants, 'teacher');
    assert.equal((await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 200);
    assert.deepEqual((await (await call(base, teacherToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).json()).items.length, 1);
    const patch = await call(base, teacherToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'teacher edit' } });
    assert.equal(patch.status, 403);
    assert.deepEqual(await patch.json(), { error: { code: 'FORBIDDEN', message: 'an active patient assignment is required' } });
    pool.state.teachers.delete(teacher);
    assert.equal((await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.deepEqual((await (await call(base, teacherToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).json()).items, []);
    const hiddenTeacherPatch = await call(base, teacherToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'nonorigin rewrite' } });
    assert.equal(hiddenTeacherPatch.status, 404);
    assert.deepEqual(await hiddenTeacherPatch.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const admin = '30000000-0000-4000-8000-000000000004';
    const adminToken = await bearer(tokens, admin, grants, 'admin');
    assert.equal((await call(base, adminToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.deepEqual((await (await call(base, adminToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).json()).items, []);
    const hiddenAdminPatch = await call(base, adminToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'admin edit' } });
    assert.equal(hiddenAdminPatch.status, 404);
    assert.deepEqual(await hiddenAdminPatch.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const deniedCreate = await call(base, adminToken, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(deniedCreate.status, 403);
    assert.deepEqual(await deniedCreate.json(), { error: { code: 'FORBIDDEN', message: 'an active student context is required' } });
    assert.deepEqual(pool.state.evaluations, saved);
    assert.deepEqual(pool.state.records, savedRecords);
    assert.equal(pool.state.commits, commits);
    assert.equal(pool.state.rollbacks, rollbacks + 4);
    assert.equal(pool.state.releases, releases + 4);
  });
});

test('detail and list are readonly and do not create history', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const created = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const before = { records: JSON.stringify(pool.state.records), evaluations: JSON.stringify(pool.state.evaluations), commits: pool.state.commits };
    const detail = await call(base, auth, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.equal(detail.status, 200);
    assert.deepEqual(await detail.json(), await created.clone().json());
    const listing = await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
    assert.equal(listing.status, 200);
    assert.equal((await listing.json()).items.length, 1);
    assert.equal(JSON.stringify(pool.state.records), before.records);
    assert.equal(JSON.stringify(pool.state.evaluations), before.evaluations);
    assert.equal(pool.state.commits, before.commits);
  });
});

test('repeated creates reuse history and PATCH preserves server-owned identity and origin', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const first = await (await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} })).json();
    const history = structuredClone(pool.state.records[0]);
    const secondResponse = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();
    assert.equal(pool.state.records.length, 1);
    assert.deepEqual(pool.state.records[0], history);
    assert.equal(second.clinical_record_id, first.clinical_record_id);
    const identity = Object.fromEntries(['author_id', 'origin_student_habilitation_id', 'origin_subject_id', 'origin_group_id'].map(key => [key, first[key]]));
    const patch = await call(base, auth, 'PATCH', `/kinesiology-evaluations/${first.id}`, { content: { illness_history: 'updated' } });
    assert.equal(patch.status, 200);
    const updated = await patch.json();
    for (const [key, value] of Object.entries(identity)) assert.equal(updated[key], value);
    assert.equal(pool.state.commits, 3);
    assert.equal(pool.state.releases, 3);
    assert.equal(pool.state.queries.some(query => query.sql.includes('ON CONFLICT (patient_id) DO NOTHING') && /RETURNING id::text AS id/.test(query.sql)), true);
    assert.equal(pool.state.queries.some(query => query.sql.startsWith('SELECT id::text AS id FROM clinical_records')), true);
  });
});

test('public draft responses project current safe patient demographics, never body identity or audit', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const created = await call(base, auth, 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group,
      content: { admission_date: '2020-05-10' },
    });
    assert.equal(created.status, 201);
    const output = await created.json();
    assert.deepEqual(output.patient, { id: patient, documento: '12345678', nombres: 'Ana', apellidos: 'Lopez', fecha_nacimiento: '1990-05-10', email: 'ana@example.com', celular: '+5491100000000', sexo: 'F', direccion: 'Calle 1' });
    assert.equal(output.age, 30);
    const patientQuery = pool.state.queries.find(query => query.sql.includes('FROM patients WHERE id'));
    for (const field of ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion']) assert.match(patientQuery.sql, new RegExp(`\\b${field}\\b`));
    for (const field of ['created_by', 'created_at', 'updated_by', 'updated_at']) assert.doesNotMatch(patientQuery.sql, new RegExp(`\\b${field}\\b`));
    for (const key of ['created_by', 'created_at', 'updated_by', 'updated_at', 'password', 'token']) assert.equal(Object.hasOwn(output.patient, key), false);
    const bodyIdentity = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, nombres: 'Spoof', content: {} });
    assert.equal(bodyIdentity.status, 400);
    pool.state.patients[0].nombres = 'Ana Actualizada';
    const detail = await call(base, auth, 'GET', `/kinesiology-evaluations/${output.id}`);
    assert.equal((await detail.json()).patient.nombres, 'Ana Actualizada');
    const patched = await call(base, auth, 'PATCH', `/kinesiology-evaluations/${output.id}`, { content: { admission_date: '2020-05-09' } });
    assert.equal(patched.status, 200);
    const patchedOutput = await patched.json();
    assert.deepEqual(patchedOutput.patient, { ...output.patient, nombres: 'Ana Actualizada' });
    assert.equal(patchedOutput.age, 29);
    const pendingAdmission = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal((await pendingAdmission.json()).age, null);
  });
});

test('hidden and missing detail/list reads create no rows and perform no writes', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const before = { records: structuredClone(pool.state.records), evaluations: structuredClone(pool.state.evaluations), commits: pool.state.commits, rollbacks: pool.state.rollbacks };
    assert.equal((await call(base, auth, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.equal((await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).status, 200);
    assert.equal((await call(base, await bearer(tokens, '30000000-0000-4000-8000-000000000002'), 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.deepEqual(pool.state.records, before.records);
    assert.deepEqual(pool.state.evaluations, before.evaluations);
    assert.equal(pool.state.commits, before.commits);
    assert.equal(pool.state.rollbacks, before.rollbacks);
  });
});

test('consent is private pending evidence until origin teacher records and verifies paper date', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const authorToken = await bearer(tokens);
    await call(base, authorToken, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: { illness_history: 'unchanged prose' } });
    const teacher = '30000000-0000-4000-8000-000000000003';
    const teacherToken = await bearer(tokens, teacher, ['kinesiology-evaluations:read', 'kinesiology-evaluations:verify-consent'], 'teacher');
    const author = await call(base, authorToken, 'GET', '/kinesiology-evaluations/9007199254740994/consent');
    assert.equal(author.status, 200);
    assert.deepEqual(await author.json(), { evaluation_id: '9007199254740994', status: 'pending', evidence: null });
    pool.state.teachers.add(teacher);
    assert.deepEqual(await (await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994/consent')).json(), { evaluation_id: '9007199254740994', status: 'pending', evidence: null });
    const beforeContent = structuredClone(pool.state.evaluations[0]);
    const verified = await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-03-08' });
    assert.equal(verified.status, 201);
    assert.deepEqual(await verified.json(), { evaluation_id: '9007199254740994', status: 'verified', evidence: { id: '9007199254740995', paper_signature_date: '2026-03-08', verified_by: teacher, verified_at: '2026-01-03T00:00:00.000Z' } });
    assert.deepEqual(pool.state.evaluations[0], beforeContent);
    assert.equal(pool.state.consents[0].teacher_habilitation_id, `teacher-period-${teacher}`);
    const lockQueries = pool.state.queries.filter(({ sql }) => sql.includes('FOR UPDATE'));
    const teacherLock = lockQueries.findLastIndex(({ sql }) => sql.includes('teacher_academic_habilitations'));
    const patientLock = lockQueries.findLastIndex(({ sql }) => sql.includes('FROM patients WHERE id'));
    const evaluationLock = lockQueries.findLastIndex(({ sql }) => sql.includes('FROM kinesiology_evaluations e') && sql.includes('FOR UPDATE'));
    assert.ok(teacherLock >= 0 && teacherLock < patientLock && patientLock < evaluationLock);
    assert.equal((await call(base, authorToken, 'GET', '/kinesiology-evaluations/9007199254740994/consent')).status, 200);
  });
});

test('consent rejects invalid bodies, non-origin actors and stale grants without changing evidence', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const teacher = '30000000-0000-4000-8000-000000000003';
    const auth = await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher');
    pool.state.teachers.add(teacher);
    const before = structuredClone(pool.state.consents);
    for (const body of [{}, { paper_signature_date: null }, { paper_signature_date: '2025-02-30' }, { paper_signature_date: '2025-01-01', verified_by: actor }]) {
      const denied = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', body);
      assert.equal(denied.status, 400);
      assert.deepEqual(pool.state.consents, before);
    }
    pool.state.grants.estudiante.push('kinesiology-evaluations:verify-consent');
    const studentBypass = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(studentBypass.status, 404);
    assert.deepEqual(pool.state.consents, before);
    const admin = '30000000-0000-4000-8000-000000000004';
    const adminAuth = await bearer(tokens, admin, ['kinesiology-evaluations:verify-consent'], 'admin');
    const adminDenied = await call(base, adminAuth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(adminDenied.status, 403);
    assert.deepEqual(pool.state.consents, before);
    const invalidId = await call(base, auth, 'POST', '/kinesiology-evaluations/9223372036854775808/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(invalidId.status, 400);
    assert.deepEqual(pool.state.consents, before);
    pool.state.teachers.delete(teacher);
    const noContext = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(noContext.status, 404);
    assert.deepEqual(pool.state.consents, before);
    pool.state.grants.teacher = [];
    pool.state.teachers.add(teacher);
    const noGrant = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(noGrant.status, 403);
    assert.deepEqual(pool.state.consents, before);
  });
});

test('consent POST hides private evaluation existence from non-origin and revoked teachers', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const created = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const teacher = '30000000-0000-4000-8000-000000000003';
    const token = await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher');
    for (const revoked of [false, true]) {
      if (revoked) {
        pool.state.teachers.add(teacher);
        assert.equal((await call(base, token, 'GET', '/kinesiology-evaluations/9007199254740994/consent')).status, 200);
        pool.state.teachers.delete(teacher);
      }
      const before = structuredClone({ records: pool.state.records, evaluations: pool.state.evaluations, consents: pool.state.consents, commits: pool.state.commits });
      const rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      for (const id of ['9007199254740994', '9007199254740999']) {
        const denied = await call(base, token, 'POST', `/kinesiology-evaluations/${id}/consent`, { paper_signature_date: '2025-01-01' });
        assert.equal(denied.status, 404);
        assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      }
      assert.deepEqual({ records: pool.state.records, evaluations: pool.state.evaluations, consents: pool.state.consents, commits: pool.state.commits }, before);
      assert.equal(pool.state.rollbacks, rollbacks + 2);
      assert.equal(pool.state.releases, releases + 2);
    }
  });
});

test('teacher consent evidence appends on repeats and failed insert rolls back and releases', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    const token = await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher');
    await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const path = '/kinesiology-evaluations/9007199254740994/consent';
    const first = await call(base, token, 'POST', path, { paper_signature_date: '2025-01-01' });
    assert.equal(first.status, 201);
    const firstEvidence = (await first.json()).evidence;
    const second = await call(base, token, 'POST', path, { paper_signature_date: '2025-02-01' });
    assert.equal(second.status, 201);
    assert.equal((await second.json()).evidence.id, '9007199254740996');
    assert.equal(pool.state.consents.length, 2);
    assert.equal(pool.state.consents[0].paper_signature_date, firstEvidence.paper_signature_date);
    const before = structuredClone(pool.state.consents);
    const commits = pool.state.commits, releases = pool.state.releases, rollbacks = pool.state.rollbacks;
    pool.state.failAt = 'after-consent-insert';
    const failure = await call(base, token, 'POST', path, { paper_signature_date: '2025-03-01' });
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
    assert.deepEqual(pool.state.consents, before);
    assert.equal(pool.state.commits, commits);
    assert.equal(pool.state.rollbacks, rollbacks + 1);
    assert.equal(pool.state.releases, releases + 1);
  });
});

test('submission rejects incomplete clinical content without creating a version or changing the draft', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const created = await call(base, auth, 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group,
      content: { illness_history: 'history only' },
    });
    assert.equal(created.status, 201);
    const before = structuredClone(pool.state.evaluations);
    const response = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: 'admission_date is required for submission' } });
    assert.deepEqual(pool.state.evaluations, before);
    assert.deepEqual(pool.state.submissions, []);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.releases, 2);
  });
});

test('verified submission freezes the complete snapshot, reports pending validation, and closes the draft', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const content = { admission_date: '2020-05-10', admission_status: 'Stable', illness_history: 'Pain began last month',
      objectives: 'Improve mobility', proposed_treatment: 'Therapeutic exercise', medical_diagnosis: null,
      kinesiology_diagnosis: 'Pending', occupation: 'Teacher', referring_physician: null,
      antecedents: { hta: null, dbt: false, diu: true },
      studies: [{ type: 'radiograph', description: 'No acute findings', date: '2020-05-09' }] };
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group, content,
    });
    assert.equal(created.status, 201);
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    const teacherToken = await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher');
    const consentResponse = await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-01-03' });
    assert.equal(consentResponse.status, 201);
    const response = await call(base, author, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(response.status, 201);
    const snapshot = await response.json();
    assert.equal(snapshot.id, '9007199254741001');
    assert.equal(snapshot.evaluation_id, '9007199254740994');
    assert.equal(snapshot.ordinal, '1');
    assert.equal(snapshot.submitted_by, actor);
    assert.equal(snapshot.submitted_at, '2026-01-04T00:00:00.000Z');
    assert.equal(snapshot.status, 'pending_validation');
    assert.deepEqual(snapshot.clinical_content, content);
    assert.deepEqual(snapshot.patient, { id: patient, documento: '12345678', nombres: 'Ana', apellidos: 'Lopez', fecha_nacimiento: '1990-05-10', email: 'ana@example.com', celular: '+5491100000000', sexo: 'F', direccion: 'Calle 1' });
    assert.equal(snapshot.age_at_admission, 30);
    assert.equal(snapshot.consent.verified_by, teacher);
    const listed = await call(base, author, 'GET', '/kinesiology-evaluations/9007199254740994/submissions');
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).items, [snapshot]);
    const detail = await call(base, author, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.equal((await detail.json()).status, 'submitted');
    const editAfterSubmit = await call(base, author, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content });
    assert.equal(editAfterSubmit.status, 409);
    assert.deepEqual(await editAfterSubmit.json(), { error: { code: 'CONFLICT', message: 'evaluation is not an editable draft' } });
    const repeated = await call(base, author, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(repeated.status, 409);
    assert.deepEqual(await repeated.json(), { error: { code: 'CONFLICT', message: 'evaluation has already been submitted' } });
    assert.equal(pool.state.submissions.length, 1);
    assert.equal(pool.state.submissionStudies.length, 1);
    assert.equal(pool.state.commits, 3);
    pool.state.patients[0].nombres = 'Changed later';
    await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-01-04' });
    const frozen = await call(base, author, 'GET', '/kinesiology-evaluations/9007199254740994/submissions');
    assert.deepEqual((await frozen.json()).items, [snapshot]);
  });
});

test('submission requires fresh submit grant and verified consent; invalid bodies and hidden actors do not mutate business state', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const content = { admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'History', objectives: 'Goal', proposed_treatment: 'Plan' };
    const auth = await bearer(tokens);
    await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
    const before = structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, studies: pool.state.submissionStudies });
    for (const body of [{ author_id: actor }, { audit: {} }]) {
      const rejected = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', body);
      assert.equal(rejected.status, 400);
      assert.deepEqual({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, studies: pool.state.submissionStudies }, before);
    }
    pool.state.grants.estudiante = ['kinesiology-evaluations:read', 'kinesiology-evaluations:write'];
    const staleGrant = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(staleGrant.status, 403);
    pool.state.grants.estudiante.push('kinesiology-evaluations:submit');
    const missingConsent = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(missingConsent.status, 409);
    const foreignToken = await bearer(tokens, '30000000-0000-4000-8000-000000000002');
    const foreign = await call(base, foreignToken, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    const missing = await call(base, foreignToken, 'POST', '/kinesiology-evaluations/9007199254740999/submissions', {});
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    pool.state.grants.admin.push('kinesiology-evaluations:submit');
    const admin = await call(base, await bearer(tokens, '30000000-0000-4000-8000-000000000004', ['kinesiology-evaluations:submit'], 'admin'), 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(admin.status, 404, 'an admin grant does not replace the linked student author context');
    assert.deepEqual({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, studies: pool.state.submissionStudies }, before);
  });
});

test('submission revalidates live author profile, active origin period, and own assignment', async () => {
  for (const revoke of [
    pool => pool.state.profiles.delete(actor),
    pool => pool.state.periods.delete(actor),
    pool => pool.state.assignments.delete(actor),
  ]) {
    const pool = fakePool();
    await withServer(pool, async (base, tokens) => {
      const content = { admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'History', objectives: 'Goal', proposed_treatment: 'Plan' };
      const auth = await bearer(tokens);
      await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
      const teacher = '30000000-0000-4000-8000-000000000003';
      pool.state.teachers.add(teacher);
      await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher'), 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-01-01' });
      const before = structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, studies: pool.state.submissionStudies });
      revoke(pool);
      const denied = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      assert.deepEqual({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, studies: pool.state.submissionStudies }, before);
    });
  }
});

test('submission rejects each missing or blank required clinical field', async () => {
  const complete = { admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'History', objectives: 'Goal', proposed_treatment: 'Plan' };
  for (const field of ['admission_date', 'admission_status', 'illness_history', 'objectives', 'proposed_treatment']) {
    const pool = fakePool();
    await withServer(pool, async (base, tokens) => {
      const content = { ...complete, ...(field === 'admission_date' ? { admission_date: null } : { [field]: '   ' }) };
      const auth = await bearer(tokens);
      await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
      const denied = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
      assert.equal(denied.status, 400);
      assert.deepEqual(await denied.json(), { error: { code: 'BAD_REQUEST', message: `${field} is required for submission` } });
      assert.equal(pool.state.submissions.length, 0);
      assert.equal(pool.state.commits, 1);
      assert.equal(pool.state.rollbacks, 1);
      assert.equal(pool.state.releases, 2);
    });
  }
});

test('submission failure rolls back snapshots and always releases transaction client', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const content = { admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'History', objectives: 'Goal', proposed_treatment: 'Plan', studies: [{ type: 'image', description: 'Report' }] };
    const auth = await bearer(tokens);
    await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher'), 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-01-01' });
    const before = structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, studies: pool.state.submissionStudies });
    const commits = pool.state.commits, releases = pool.state.releases, rollbacks = pool.state.rollbacks;
    pool.state.failAt = 'after-study-insert';
    const failure = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(failure.status, 500);
    assert.deepEqual({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, studies: pool.state.submissionStudies }, before);
    assert.equal(pool.state.commits, commits);
    assert.equal(pool.state.rollbacks, rollbacks + 1);
    assert.equal(pool.state.releases, releases + 1);
  });
});

test('origin teacher can request a reasoned correction for a submitted version', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const content = { admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'Version one', objectives: 'Goal', proposed_treatment: 'Plan', studies: [{ type: 'x-ray', description: 'original report' }] };
    await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    const teacherToken = await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher');
    await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher'), 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-01-01' });
    assert.equal((await call(base, author, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {})).status, 201);
    const unchanged = () => structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions,
      studies: pool.state.submissionStudies, corrections: pool.state.correctionRequests, commits: pool.state.commits });
    const beforeInvalid = unchanged();
    for (const body of [
      {}, { submission_id: null, reason: 'valid' }, { submission_id: '01', reason: 'valid' },
      { submission_id: '9223372036854775808', reason: 'valid' }, { submission_id: '9007199254741001', reason: '' },
      { submission_id: '9007199254741001', reason: null }, { submission_id: '9007199254741001', reason: 'valid', reviewed_by: teacher },
      { submission_id: '9007199254741001', reason: 'valid', requested_at: '2020-01-01T00:00:00Z' },
    ]) {
      const invalid = await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/corrections', body);
      assert.equal(invalid.status, 400);
      assert.deepEqual(unchanged(), beforeInvalid);
    }
    const teacherGrants = pool.state.grants.teacher;
    pool.state.grants.teacher = teacherGrants.filter(permission => permission !== 'kinesiology-evaluations:review');
    const noGrant = await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher'), 'POST', '/kinesiology-evaluations/9007199254740994/corrections', { submission_id: '9007199254741001', reason: 'valid' });
    assert.equal(noGrant.status, 403);
    pool.state.grants.teacher = teacherGrants;
    assert.deepEqual(unchanged(), beforeInvalid);
    const hidden = await call(base, await bearer(tokens, '30000000-0000-4000-8000-000000000004', ['kinesiology-evaluations:review'], 'admin'), 'POST', '/kinesiology-evaluations/9007199254740994/corrections', { submission_id: '9007199254741001', reason: 'valid' });
    assert.equal(hidden.status, 403);
    assert.deepEqual(unchanged(), beforeInvalid);
    const beforeFailure = unchanged();
    const failedCommits = pool.state.commits, failedRollbacks = pool.state.rollbacks, failedReleases = pool.state.releases;
    pool.state.failAt = 'after-correction-event';
    const failedRequest = await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/corrections', { submission_id: '9007199254741001', reason: 'valid reason' });
    assert.equal(failedRequest.status, 500);
    assert.deepEqual(unchanged(), beforeFailure);
    assert.equal(pool.state.commits, failedCommits);
    assert.equal(pool.state.rollbacks, failedRollbacks + 1);
    assert.equal(pool.state.releases, failedReleases + 1);
    for (const failAt of ['after-correction-draft', 'no-correction-draft-update']) {
      pool.state.failAt = failAt;
      const before = unchanged();
      const commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      const failed = await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/corrections', { submission_id: '9007199254741001', reason: 'valid reason' });
      assert.equal(failed.status, failAt === 'after-correction-draft' ? 500 : 409);
      assert.deepEqual(unchanged(), before);
      assert.equal(pool.state.commits, commits);
      assert.equal(pool.state.rollbacks, rollbacks + 1);
      assert.equal(pool.state.releases, releases + 1);
    }
    pool.state.failAt = null;
    const response = await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/corrections', { submission_id: '9007199254741001', reason: '  Please clarify the history.  ' });
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    assert.deepEqual(await response.json(), { evaluation_id: '9007199254740994', submission_id: '9007199254741001', status: 'draft', correction_request_id: '9007199254741100', requested_at: '2026-02-01T00:00:00.000Z' });
    assert.deepEqual(pool.state.evaluations[0].content, content);
    assert.equal(pool.state.evaluations[0].correction_from_submission_id, '9007199254741001');
    assert.equal(pool.state.correctionRequests[0].reason, 'Please clarify the history.');
    assert.equal(pool.state.correctionRequests[0].reviewed_by, teacher);
    const eventInsert = pool.state.queries.findLast(query => query.sql.includes('INSERT INTO kinesiology_evaluation_correction_requests'));
    assert.deepEqual(eventInsert.params, ['9007199254740994', '9007199254741001', 'Please clarify the history.', teacher]);
    assert.match(eventInsert.sql, /RETURNING id::text AS id, requested_at/);
    const correctionRead = await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994/corrections');
    assert.equal(correctionRead.status, 200);
    assert.deepEqual(await correctionRead.json(), { evaluation_id: '9007199254740994', items: [{ submission_id: '9007199254741001', reason: 'Please clarify the history.', reviewed_by: teacher, requested_at: '2026-02-01T00:00:00.000Z' }] });
    const authorReasons = await call(base, author, 'GET', '/kinesiology-evaluations/9007199254740994/corrections');
    assert.equal(authorReasons.status, 200);
    const readGrants = pool.state.grants.teacher;
    pool.state.grants.teacher = readGrants.filter(permission => permission !== 'kinesiology-evaluations:read');
    const readCommits = pool.state.commits, readReleases = pool.state.releases;
    const deniedRead = await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994/corrections');
    assert.equal(deniedRead.status, 403);
    assert.equal(pool.state.commits, readCommits);
    assert.equal(pool.state.releases, readReleases);
    pool.state.grants.teacher = readGrants;
    const crossReader = await bearer(tokens, '30000000-0000-4000-8000-000000000002');
    const hiddenReason = await call(base, crossReader, 'GET', '/kinesiology-evaluations/9007199254740994/corrections');
    assert.equal(hiddenReason.status, 404);
    assert.deepEqual(await hiddenReason.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const duringEdit = await call(base, crossReader, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.equal(duringEdit.status, 200);
    const projected = await duringEdit.json();
    assert.equal(projected.content.illness_history, 'Version one');
    assert.equal(projected.status, 'submitted');
    const edit = await call(base, author, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { ...content, illness_history: 'Corrected history', studies: [{ type: 'image', description: 'new study' }] } });
    assert.equal(edit.status, 200);
    assert.equal(pool.state.submissions[0].clinical_content.illness_history, 'Version one');
    assert.deepEqual(pool.state.submissionStudies.map(row => row.submission_id), ['9007199254741001']);
    const resubmitted = await call(base, author, 'POST', '/kinesiology-evaluations/9007199254740994/submissions', {});
    assert.equal(resubmitted.status, 201);
    assert.equal((await resubmitted.json()).ordinal, '2');
    assert.equal(pool.state.submissions[0].clinical_content.illness_history, 'Version one');
    assert.equal(pool.state.submissions[1].clinical_content.illness_history, 'Corrected history');
    assert.equal(pool.state.submissions[1].verified_consent_snapshot.paper_signature_date, '2026-01-01');
    assert.deepEqual(pool.state.submissionStudies.map(row => row.submission_id), ['9007199254741001', '9007199254741002']);
    assert.deepEqual(pool.state.submissionStudies[1], { submission_id: '9007199254741002', ordinal: 0, type: 'image', description: 'new study', date: null });
  });
});

test('correction targets reject foreign, absent, stale, draft, and already-requested versions atomically', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000031';
    const first = await createSubmitted(pool, base, tokens, teacher);
    const second = await createSubmitted(pool, base, tokens, teacher);
    const teacherToken = await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher');
    const path = `/kinesiology-evaluations/${first.evaluationId}/corrections`;
    const before = () => structuredClone({ records: pool.state.records, evaluations: pool.state.evaluations,
      submissions: pool.state.submissions, studies: pool.state.submissionStudies, consents: pool.state.consents,
      events: pool.state.correctionRequests });
    const rejectUnchanged = async (submissionId, status, body) => {
      const saved = before(), commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      const response = await call(base, teacherToken, 'POST', path, { submission_id: submissionId, reason: 'Review' });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
      assert.deepEqual(before(), saved);
      assert.equal(pool.state.commits, commits);
      assert.equal(pool.state.rollbacks, rollbacks + 1);
      assert.equal(pool.state.releases, releases + 1);
    };
    await rejectUnchanged(second.submissionId, 404, { error: { code: 'NOT_FOUND', message: 'submission was not found' } });
    await rejectUnchanged('9007199254741999', 404, { error: { code: 'NOT_FOUND', message: 'submission was not found' } });
    const requested = await call(base, teacherToken, 'POST', path, { submission_id: first.submissionId, reason: 'Correction one' });
    assert.equal(requested.status, 201);
    const correctionDraft = await call(base, first.author, 'PATCH', `/kinesiology-evaluations/${first.evaluationId}`, { content: {
      admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'Version two', objectives: 'Goal', proposed_treatment: 'Plan',
    } });
    assert.equal(correctionDraft.status, 200);
    const resubmitted = await call(base, first.author, 'POST', `/kinesiology-evaluations/${first.evaluationId}/submissions`, {});
    assert.equal(resubmitted.status, 201);
    const secondVersion = (await resubmitted.json()).id;
    await rejectUnchanged(first.submissionId, 409, { error: { code: 'CONFLICT', message: 'submission is not the latest version' } });
    const nextCorrection = await call(base, teacherToken, 'POST', path, { submission_id: secondVersion, reason: 'Correction two' });
    assert.equal(nextCorrection.status, 201);
    await rejectUnchanged(secondVersion, 409, { error: { code: 'CONFLICT', message: 'evaluation is not awaiting correction' } });
    const draft = await call(base, first.author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(draft.status, 201);
    const draftId = (await draft.json()).id;
    const saved = before(), commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
    const notSubmitted = await call(base, teacherToken, 'POST', `/kinesiology-evaluations/${draftId}/corrections`, { submission_id: second.submissionId, reason: 'No submission yet' });
    assert.equal(notSubmitted.status, 409);
    assert.deepEqual(await notSubmitted.json(), { error: { code: 'CONFLICT', message: 'evaluation is not awaiting correction' } });
    assert.deepEqual(before(), saved);
    assert.equal(pool.state.commits, commits);
    assert.equal(pool.state.rollbacks, rollbacks + 1);
    assert.equal(pool.state.releases, releases + 1);
  });
});

test('correction review revalidates locked target identity and origin before recording events', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000032';
    const submitted = await createSubmitted(pool, base, tokens, teacher);
    const token = await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher');
    pool.state.teacherContexts.set(teacher, { profile: true, contexts: [
      { subject_id: subject, group_id: group, id: '10' },
      { subject_id: subject, group_id: group, id: '2' },
    ] });
    for (const [mutation, expectedStatus] of [
      [row => { row.author_id = '30000000-0000-4000-8000-000000000099'; }, 404],
      [row => { row.origin_subject_id = otherSubject; }, 404],
      [row => { row.status = 'draft'; }, 409],
    ]) {
      const saved = structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, events: pool.state.correctionRequests });
      const commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      pool.state.hintMutation = mutation;
      const result = await call(base, token, 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`, { submission_id: submitted.submissionId, reason: 'Check' });
      assert.equal(result.status, expectedStatus);
      assert.deepEqual({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, events: pool.state.correctionRequests }, saved);
      assert.equal(pool.state.commits, commits);
      assert.equal(pool.state.rollbacks, rollbacks + 1);
      assert.equal(pool.state.releases, releases + 1);
    }
    const accepted = await call(base, token, 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`, { submission_id: submitted.submissionId, reason: 'Check lock ordering' });
    assert.equal(accepted.status, 201);
    const correctionQueries = pool.state.queries.slice().filter(query => query.sql.includes('teacher_academic_habilitations') && query.sql.includes('FOR UPDATE'));
    assert.ok(correctionQueries.length >= 3);
    assert.match(correctionQueries.at(-1).sql, /ORDER BY th\.id FOR UPDATE OF th/);
    // This checks repository query ordering in the fake; it is not PostgreSQL lock/concurrency proof.
    assert.deepEqual(pool.state.transactionLockOrder, ['teacher-period', 'patient', 'evaluation', 'submission']);
    assert.deepEqual(pool.state.teacherPeriodLockIds, ['2', '10']);
  });
});

test('review requires a linked live origin teacher profile and exact active context', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const owner = '30000000-0000-4000-8000-000000000033';
    const submitted = await createSubmitted(pool, base, tokens, owner);
    const cases = [
      { profile: false, contexts: [{ subject_id: subject, group_id: group, id: '1' }] },
      { profile: true, contexts: [] },
      { profile: true, contexts: [{ subject_id: otherSubject, group_id: group, id: '2' }] },
      { profile: true, contexts: [{ subject_id: subject, group_id: otherGroup, id: '3' }] },
      { profile: true, contexts: [{ subject_id: subject, group_id: group, id: '4', revoked_at: '2026-01-02T00:00:00Z' }] },
    ];
    const missing = await call(base, await bearer(tokens, owner, ['kinesiology-evaluations:review'], 'teacher'), 'POST', '/kinesiology-evaluations/9007199254741999/corrections', { submission_id: submitted.submissionId, reason: 'Review' });
    const missingBody = await missing.json();
    for (const [index, context] of cases.entries()) {
      const candidate = `30000000-0000-4000-8000-${String(index + 41).padStart(12, '0')}`;
      pool.state.teacherContexts.set(candidate, context);
      const commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      const denied = await call(base, await bearer(tokens, candidate, ['kinesiology-evaluations:review'], 'teacher'), 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`, { submission_id: submitted.submissionId, reason: 'Review' });
      assert.equal(denied.status, missing.status);
      assert.deepEqual(await denied.json(), missingBody);
      assert.equal(pool.state.commits, commits);
      assert.equal(pool.state.rollbacks, rollbacks + 1);
      assert.equal(pool.state.releases, releases + 1);
    }
    const before = { commits: pool.state.commits, rollbacks: pool.state.rollbacks, releases: pool.state.releases };
    pool.state.grants.teacher = pool.state.grants.teacher.filter(permission => permission !== 'kinesiology-evaluations:review');
    const staleGrant = await call(base, await bearer(tokens, owner, ['kinesiology-evaluations:review'], 'teacher'), 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`, { submission_id: submitted.submissionId, reason: 'Review' });
    assert.equal(staleGrant.status, 403);
    assert.deepEqual({ commits: pool.state.commits, rollbacks: pool.state.rollbacks, releases: pool.state.releases }, before);
    pool.state.grants.teacher.push('kinesiology-evaluations:review');
    const businessBeforeRoleDenials = structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, events: pool.state.correctionRequests });
    for (const [role, user] of [['estudiante', actor], ['admin', '30000000-0000-4000-8000-000000000044']]) {
      pool.state.grants[role].push('kinesiology-evaluations:review');
      const denied = await call(base, await bearer(tokens, user, ['kinesiology-evaluations:review'], role), 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`, { submission_id: submitted.submissionId, reason: 'Review' });
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      pool.state.grants[role] = pool.state.grants[role].filter(permission => permission !== 'kinesiology-evaluations:review');
    }
    assert.deepEqual({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, events: pool.state.correctionRequests }, businessBeforeRoleDenials);
    const beforeMalformed = { commits: pool.state.commits, rollbacks: pool.state.rollbacks, releases: pool.state.releases };
    const malformed = await call(base, await bearer(tokens, 'not-a-uuid', ['kinesiology-evaluations:review'], 'teacher'), 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`, { submission_id: submitted.submissionId, reason: 'Review' });
    assert.equal(malformed.status, 401);
    assert.deepEqual({ commits: pool.state.commits, rollbacks: pool.state.rollbacks, releases: pool.state.releases }, beforeMalformed);
  });
});

test('former author access requires current assignment and corrections remain origin-only', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000034';
    const submitted = await createSubmitted(pool, base, tokens, teacher, {
      admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'Version one',
      objectives: 'Goal', proposed_treatment: 'Plan', studies: [{ type: 'x-ray', description: 'frozen' }],
    });
    pool.state.assignments.delete(actor);
    const teacherToken = await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher');
    const correction = await call(base, teacherToken, 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`, { submission_id: submitted.submissionId, reason: 'Need clarification' });
    assert.equal(correction.status, 201);
    const readers = await Promise.all([
      call(base, submitted.author, 'PATCH', `/kinesiology-evaluations/${submitted.evaluationId}`, { content: { illness_history: 'Denied' } }),
      call(base, submitted.author, 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/submissions`, {}),
      call(base, submitted.author, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`),
    ]);
    assert.deepEqual(readers.map(response => response.status), [404, 404, 404]);
    const cross = await bearer(tokens, '30000000-0000-4000-8000-000000000002');
    const crossReasons = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`);
    assert.equal(crossReasons.status, 404);
    assert.deepEqual(await crossReasons.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const crossDetail = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}`);
    const during = await crossDetail.json();
    assert.equal(during.content.illness_history, 'Version one');
    assert.equal(Object.hasOwn(during, 'corrections'), false);
    const crossList = await call(base, cross, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
    assert.equal((await crossList.json()).items[0].content.illness_history, 'Version one');
    const crossHistory = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}/submissions`);
    assert.equal((await crossHistory.json()).items[0].clinical_content.illness_history, 'Version one');
    pool.state.assignments.add(actor);
    pool.state.currentPeriodIds.set(actor, '60000000-0000-4000-8000-000000000099');
    const edit = await call(base, submitted.author, 'PATCH', `/kinesiology-evaluations/${submitted.evaluationId}`, { content: {
      admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'Version two', objectives: 'Goal', proposed_treatment: 'Plan', studies: [{ type: 'x-ray', description: 'updated' }],
    } });
    assert.equal(edit.status, 200);
    assert.equal(pool.state.evaluations[0].author_id, actor);
    assert.equal(pool.state.evaluations[0].origin_student_habilitation_id, period);
    const resubmitted = await call(base, submitted.author, 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/submissions`, {});
    assert.equal(resubmitted.status, 201);
    assert.equal((await resubmitted.json()).ordinal, '2');
    const newest = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}`);
    assert.equal((await newest.json()).content.illness_history, 'Version two');
    const newestList = await call(base, cross, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
    assert.equal((await newestList.json()).items.find(item => item.id === submitted.evaluationId).content.illness_history, 'Version two');
    const newestHistory = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}/submissions`);
    const latestVersions = (await newestHistory.json()).items;
    assert.equal(latestVersions.length, 1);
    assert.equal(latestVersions[0].clinical_content.illness_history, 'Version two');
    const stillPrivate = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}/corrections`);
    assert.equal(stillPrivate.status, 404);
    assert.deepEqual(await stillPrivate.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
  });
});

test('origin teacher validates the latest submitted version with server-owned review facts', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000071';
    const submitted = await createSubmitted(pool, base, tokens, teacher, {
      admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'History',
      objectives: 'Goal', proposed_treatment: 'Plan', kinesiology_diagnosis: null,
    });
    const token = await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher');
    const response = await call(base, token, 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/validations`, { submission_id: submitted.submissionId });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      evaluation_id: submitted.evaluationId, submission_id: submitted.submissionId,
      status: 'validated', reviewed_by: teacher, reviewed_at: '2026-02-01T00:00:00.000Z',
    });
    assert.equal(pool.state.evaluations[0].status, 'validated');
    const history = await call(base, token, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}/submissions`);
    assert.equal(history.status, 200);
    assert.equal((await history.json()).items[0].status, 'validated');
    assert.deepEqual(pool.state.submissions[0].clinical_content.kinesiology_diagnosis, null);
    const cross = await bearer(tokens, '30000000-0000-4000-8000-000000000002');
    const crossRead = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}`);
    assert.equal((await crossRead.json()).validation_status, 'validated');
    const crossList = await call(base, cross, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
    assert.equal((await crossList.json()).items[0].validation_status, 'validated');
    const crossHistory = await call(base, cross, 'GET', `/kinesiology-evaluations/${submitted.evaluationId}/submissions`);
    assert.equal((await crossHistory.json()).items[0].status, 'validated');
    const before = structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, validations: pool.state.validationReviews });
    const repeated = await call(base, token, 'POST', `/kinesiology-evaluations/${submitted.evaluationId}/validations`, { submission_id: submitted.submissionId });
    assert.equal(repeated.status, 409);
    assert.deepEqual({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, validations: pool.state.validationReviews }, before);
    const edit = await call(base, submitted.author, 'PATCH', `/kinesiology-evaluations/${submitted.evaluationId}`, { content: { illness_history: 'rewrite' } });
    assert.equal(edit.status, 409);
    assert.deepEqual(pool.state.submissions[0].clinical_content.illness_history, 'History');
  });
});

test('validation requires a fresh grant and live origin teacher profile/context, rechecking identity under locks', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000073';
    const submitted = await createSubmitted(pool, base, tokens, teacher);
    const path = `/kinesiology-evaluations/${submitted.evaluationId}/validations`;
    const body = { submission_id: submitted.submissionId };
    const deniedState = () => structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions, reviews: pool.state.validationReviews });
    const saved = deniedState();
    const commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
    const grants = pool.state.grants.teacher;
    pool.state.grants.teacher = grants.filter(permission => permission !== 'kinesiology-evaluations:review');
    const noGrant = await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher'), 'POST', path, body);
    assert.equal(noGrant.status, 403);
    assert.deepEqual(deniedState(), saved);
    assert.equal(pool.state.commits, commits);
    assert.equal(pool.state.rollbacks, rollbacks);
    assert.equal(pool.state.releases, releases);
    pool.state.grants.teacher = grants;
    pool.state.teachers.delete(teacher);
    const noContext = await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher'), 'POST', path, body);
    assert.equal(noContext.status, 404);
    assert.deepEqual(await noContext.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    assert.deepEqual(deniedState(), saved);
    pool.state.teachers.add(teacher);
    for (const [label, mutate] of [
      ['profile', () => pool.state.teacherContexts.set(teacher, { profile: false, contexts: [{ subject_id: subject, group_id: group, id: '1' }] })],
      ['revoked context', () => pool.state.teacherContexts.set(teacher, { profile: true, contexts: [{ subject_id: subject, group_id: group, id: '2', revoked_at: '2026-01-01' }] })],
    ]) {
      mutate();
      const denied = await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher'), 'POST', path, body);
      assert.equal(denied.status, 404, label);
      assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      assert.deepEqual(deniedState(), saved);
    }
    pool.state.teacherContexts.delete(teacher);
    for (const [role, user] of [['estudiante', actor], ['admin', '30000000-0000-4000-8000-000000000074']]) {
      const roleGrants = pool.state.grants[role];
      pool.state.grants[role] = [...roleGrants, 'kinesiology-evaluations:review'];
      const denied = await call(base, await bearer(tokens, user, ['kinesiology-evaluations:review'], role), 'POST', path, body);
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      pool.state.grants[role] = roleGrants;
      assert.deepEqual(deniedState(), saved);
    }
    pool.state.hintMutation = row => { row.origin_subject_id = otherSubject; };
    const changed = await call(base, await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher'), 'POST', path, body);
    assert.equal(changed.status, 404);
    assert.deepEqual(deniedState(), saved);
    assert.deepEqual(pool.state.transactionLockOrder, ['teacher-period', 'patient', 'evaluation']);
    assert.deepEqual(pool.state.teacherPeriodLockIds, [`teacher-period-${teacher}`]);
  });
});

test('validation rejects nonlatest/foreign/draft targets and rolls back event or status failures', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000072';
    const first = await createSubmitted(pool, base, tokens, teacher);
    const second = await createSubmitted(pool, base, tokens, teacher);
    const token = await bearer(tokens, teacher, ['kinesiology-evaluations:review'], 'teacher');
    const path = `/kinesiology-evaluations/${first.evaluationId}/validations`;
    const before = () => structuredClone({ evaluations: pool.state.evaluations, submissions: pool.state.submissions,
      studies: pool.state.submissionStudies, reviews: pool.state.validationReviews });
    const rejectUnchanged = async (submissionId, status, body) => {
      const saved = before(), commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      const response = await call(base, token, 'POST', path, { submission_id: submissionId });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
      assert.deepEqual(before(), saved);
      assert.equal(pool.state.commits, commits);
      assert.equal(pool.state.rollbacks, rollbacks + 1);
      assert.equal(pool.state.releases, releases + 1);
    };
    await rejectUnchanged(second.submissionId, 404, { error: { code: 'NOT_FOUND', message: 'submission was not found' } });
    await rejectUnchanged('9007199254741999', 404, { error: { code: 'NOT_FOUND', message: 'submission was not found' } });
    const draft = await call(base, first.author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(draft.status, 201);
    const draftId = (await draft.json()).id;
    const draftSaved = before(), draftCommits = pool.state.commits, draftRollbacks = pool.state.rollbacks, draftReleases = pool.state.releases;
    const draftValidation = await call(base, token, 'POST', `/kinesiology-evaluations/${draftId}/validations`, { submission_id: first.submissionId });
    assert.equal(draftValidation.status, 409);
    assert.deepEqual(await draftValidation.json(), { error: { code: 'CONFLICT', message: 'evaluation is not awaiting validation' } });
    assert.deepEqual(before(), draftSaved);
    assert.equal(pool.state.commits, draftCommits);
    assert.equal(pool.state.rollbacks, draftRollbacks + 1);
    assert.equal(pool.state.releases, draftReleases + 1);
    const requested = await call(base, token, 'POST', `/kinesiology-evaluations/${first.evaluationId}/corrections`, { submission_id: first.submissionId, reason: 'Update' });
    assert.equal(requested.status, 201);
    assert.equal((await call(base, first.author, 'PATCH', `/kinesiology-evaluations/${first.evaluationId}`, { content: {
      admission_date: '2026-01-01', admission_status: 'Stable', illness_history: 'Resubmitted', objectives: 'Goal', proposed_treatment: 'Plan',
    } })).status, 200);
    const resubmission = await call(base, first.author, 'POST', `/kinesiology-evaluations/${first.evaluationId}/submissions`, {});
    assert.equal(resubmission.status, 201);
    const resubmitted = await resubmission.json();
    await rejectUnchanged(first.submissionId, 409, { error: { code: 'CONFLICT', message: 'submission is not the latest version' } });
    for (const failAt of ['after-validation-review', 'after-validation-update']) {
      pool.state.failAt = failAt;
      const saved = before(), commits = pool.state.commits, rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      const failed = await call(base, token, 'POST', path, { submission_id: resubmitted.id });
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
      assert.deepEqual(before(), saved);
      assert.equal(pool.state.commits, commits);
      assert.equal(pool.state.rollbacks, rollbacks + 1);
      assert.equal(pool.state.releases, releases + 1);
    }
  });
});

test('fake SQL failures after writes roll back business state and always release without commit', async () => {
  for (const failAt of ['after-history-insert', 'after-edit-update']) {
    const pool = fakePool();
    await withServer(pool, async (base, tokens) => {
      const auth = await bearer(tokens);
      if (failAt === 'after-edit-update') {
        await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: { illness_history: 'original' } });
      }
      const before = { records: structuredClone(pool.state.records), evaluations: structuredClone(pool.state.evaluations), commits: pool.state.commits, releases: pool.state.releases, rollbacks: pool.state.rollbacks };
      pool.state.failAt = failAt;
      const response = failAt === 'after-history-insert'
        ? await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} })
        : await call(base, auth, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'changed' } });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
      assert.deepEqual(pool.state.records, before.records);
      assert.deepEqual(pool.state.evaluations, before.evaluations);
      assert.equal(pool.state.commits, before.commits);
      assert.equal(pool.state.rollbacks, before.rollbacks + 1);
      assert.equal(pool.state.releases, before.releases + 1);
    });
  }
});
