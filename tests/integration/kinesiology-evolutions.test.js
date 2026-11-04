import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const selected = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
const timeout = 5000;
let pool, server, baseUrl, config, JwtTokenService, cleanDb;
let cleanupAuthorized = false;
let serial = 0;

function safeError(error) {
  return error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s'"),]+/gi, '[database-url]')
    : 'unknown error';
}
function name(prefix) { return `${prefix}${process.pid}${++serial}${randomUUID().replaceAll('-', '').slice(0, 8)}`; }
async function token(actor) {
  return new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn })
    .sign({ role: actor.role, sub: actor.id, username: actor.username });
}
async function request(method, path, jwt, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(9000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function fixture() {
  const { rows: users } = await pool.query(`INSERT INTO users(username,password_hash,role) VALUES
    ($1,'unused','admin'),($2,'unused','teacher'),($3,'unused','teacher'),($4,'unused','estudiante'),($5,'unused','estudiante')
    RETURNING id,username,role`, [name('admin'), name('teacher'), name('otherteacher'), name('student'), name('otherstudent')]);
  const [admin, teacher, otherTeacher, student, otherStudent] = users;
  const teachers = (await pool.query(`INSERT INTO teachers(user_id,nombres,apellidos) VALUES
    ($1,'Origin','Teacher'),($2,'Other','Teacher') RETURNING id,user_id`, [teacher.id, otherTeacher.id])).rows;
  const students = (await pool.query(`INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES
    ($1,'Origin','Student',$2),($3,'Other','Student',$4) RETURNING id,user_id`,
  [student.id, name('STU'), otherStudent.id, name('STU')])).rows;
  const subjects = (await pool.query('INSERT INTO subjects(name) VALUES ($1),($2) RETURNING id', [name('subject'), name('subject')])).rows;
  const groups = (await pool.query(`INSERT INTO academic_groups(academic_year,curriculum_semester,name)
    VALUES (2098,1,$1),(2098,1,$2) RETURNING id`, [name('group'), name('group')])).rows;
  const origin = { subject: subjects[0].id, group: groups[0].id };
  const other = { subject: subjects[1].id, group: groups[1].id };
  for (const context of [origin, other]) {
    await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id) VALUES ($1,$2)', [context.subject, context.group]);
  }
  await pool.query(`INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$7,$4,clock_timestamp())`,
  [teachers[0].id, origin.subject, origin.group, admin.id, teachers[1].id, other.subject, other.group]);
  const periods = (await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$7,$4,clock_timestamp()) RETURNING id,student_id`,
  [students[0].id, origin.subject, origin.group, admin.id, students[1].id, other.subject, other.group])).rows;
  const patient = (await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion)
    VALUES ($1,'Fixture','Patient','2000-02-29',$2,'00000000','F','Fixture address') RETURNING id`,
  [String(10000000 + serial), `${name('patient')}@example.test`])).rows[0].id;
  const assignments = (await pool.query(`INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by)
    VALUES ($1,$2,$3,$4),($1,$5,$6,$7) RETURNING id,student_habilitation_id`,
  [patient, periods[0].id, origin.subject, teacher.id, periods[1].id, other.subject, otherTeacher.id])).rows;
  const originAssignment = assignments.find(row => row.student_habilitation_id === periods[0].id);
  const otherAssignment = assignments.find(row => row.student_habilitation_id === periods[1].id);
  assert.ok(originAssignment && otherAssignment, 'each context has its matching patient assignment');
  return { admin, teacher, otherTeacher, student, otherStudent, patient, origin, other,
    period: periods[0].id, otherPeriod: periods[1].id, assignments, originAssignmentId: originAssignment.id };
}

async function addStudentPeriod(f, studentUserId, context, assignedBy) {
  const student = (await pool.query('SELECT id FROM students WHERE user_id=$1', [studentUserId])).rows[0];
  assert.ok(student, 'fixture student profile exists');
  const period = (await pool.query(`INSERT INTO student_academic_habilitations
    (student_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id`,
  [student.id, context.subject, context.group, f.admin.id])).rows[0];
  const assignment = (await pool.query(`INSERT INTO patient_assignments
    (patient_id,student_habilitation_id,subject_id,assigned_by)
    VALUES ($1,$2,$3,$4) RETURNING id`, [f.patient, period.id, context.subject, assignedBy])).rows[0];
  return { period: period.id, assignment: assignment.id };
}

async function renewStudentPeriod(f, oldPeriod, studentUserId, context, assignedBy, endedBy) {
  const ended = await pool.query(`UPDATE patient_assignments SET ended_by=$2,ended_at=clock_timestamp()
    WHERE student_habilitation_id=$1 AND ended_at IS NULL RETURNING id`, [oldPeriod, endedBy]);
  assert.ok(ended.rowCount > 0, 'renewal ends the previous active assignment with an actor');
  await pool.query(`UPDATE student_academic_habilitations SET revoked_by=$2,revoked_at=clock_timestamp()
    WHERE id=$1 AND revoked_at IS NULL`, [oldPeriod, endedBy]);
  return addStudentPeriod(f, studentUserId, context, assignedBy);
}

async function fkConstraintName(client, sourceTable, sourceColumns, targetTable, targetColumns) {
  const { rows } = await client.query(`SELECT c.conname,
      array_agg(sa.attname::text ORDER BY sk.ordinality) AS source_columns,
      array_agg(ta.attname::text ORDER BY tk.ordinality) AS target_columns
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class s ON s.oid=c.conrelid
    JOIN pg_catalog.pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_catalog.pg_class t ON t.oid=c.confrelid
    JOIN pg_catalog.pg_namespace tn ON tn.oid=t.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY sk(attnum,ordinality) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY tk(attnum,ordinality) ON tk.ordinality=sk.ordinality
    JOIN pg_catalog.pg_attribute sa ON sa.attrelid=s.oid AND sa.attnum=sk.attnum
    JOIN pg_catalog.pg_attribute ta ON ta.attrelid=t.oid AND ta.attnum=tk.attnum
    WHERE c.contype='f' AND sn.nspname='public' AND tn.nspname='public'
      AND s.relname=$1 AND t.relname=$2
    GROUP BY c.oid,c.conname`, [sourceTable, targetTable]);
  const matches = rows.filter(row => JSON.stringify(row.source_columns) === JSON.stringify(sourceColumns)
    && JSON.stringify(row.target_columns) === JSON.stringify(targetColumns));
  assert.equal(matches.length, 1, `expected exactly one ${sourceTable} composite FK to ${targetTable}`);
  return matches[0].conname;
}

async function checkConstraintName(client, table, sqlFragment) {
  const { rows } = await client.query(`SELECT c.conname,pg_catalog.pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    WHERE c.contype='c' AND n.nspname='public' AND r.relname=$1`, [table]);
  const matches = rows.filter(row => row.definition.includes(sqlFragment));
  assert.equal(matches.length, 1, `expected exactly one ${table} check constraint for ${sqlFragment}`);
  return matches[0].conname;
}

async function expectConstraint(probe, savepoint, sql, params, sqlstate, constraint) {
  await probe.query(`SAVEPOINT ${savepoint}`);
  let observed;
  try { await probe.query(sql, params); } catch (error) { observed = error; }
  assert.ok(observed, `${constraint} should reject the invalid row`);
  assert.equal(observed.code, sqlstate);
  assert.equal(observed.constraint, constraint);
  await probe.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
}

async function publicState(jwt, patientId, ids) {
  const [list, documents] = await Promise.all([
    request('GET', `/kinesiology-evolutions?patient_id=${patientId}`, jwt),
    Promise.all(ids.map(async id => {
      const [detail, submissions, corrections] = await Promise.all([
        request('GET', `/kinesiology-evolutions/${id}`, jwt),
        request('GET', `/kinesiology-evolutions/${id}/submissions`, jwt),
        request('GET', `/kinesiology-evolutions/${id}/corrections`, jwt),
      ]);
      return { detail, submissions, corrections };
    })),
  ]);
  return { list, documents };
}

const evaluationContent = {
  admission_date: '2026-01-15', admission_status: 'Stable', illness_history: 'Pain began four weeks ago',
  objectives: 'Restore mobility', proposed_treatment: 'Therapeutic exercise', medical_diagnosis: null,
  kinesiology_diagnosis: 'Pending', occupation: 'Teacher', referring_physician: null,
  antecedents: { hta: null, dbt: false, diu: true }, studies: [],
};
const evolutionContent = (overrides = {}) => ({ session_date: '2026-02-03', current_status: 'Improved mobility',
  objectives: 'Increase range of motion', planned_treatment: 'Guided exercise', ...overrides });

async function validEvaluation(f, studentJwt, teacherJwt) {
  const created = await request('POST', '/kinesiology-evaluations', studentJwt, {
    patient_id: f.patient, subject_id: f.origin.subject, academic_group_id: f.origin.group, content: evaluationContent,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const consent = await request('POST', `/kinesiology-evaluations/${created.body.id}/consent`, teacherJwt,
    { paper_signature_date: '2026-01-12' });
  assert.equal(consent.status, 201, JSON.stringify(consent.body));
  const submitted = await request('POST', `/kinesiology-evaluations/${created.body.id}/submissions`, studentJwt, {});
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const validated = await request('POST', `/kinesiology-evaluations/${created.body.id}/validations`, teacherJwt,
    { submission_id: submitted.body.id });
  assert.equal(validated.status, 201, JSON.stringify(validated.body));
  return created.body;
}
async function createEvolution(f, evaluation, jwt, content = {}) {
  return request('POST', '/kinesiology-evolutions', jwt, { patient_id: f.patient, evaluation_id: evaluation.id,
    subject_id: f.origin.subject, academic_group_id: f.origin.group, content });
}
async function baselineCounts(patient) {
  const { rows } = await pool.query(`SELECT
    (SELECT count(*)::int FROM kinesiology_evolutions WHERE patient_id=$1) AS documents,
    (SELECT count(*)::int FROM kinesiology_evolution_submissions s JOIN kinesiology_evolutions e ON e.id=s.evolution_id WHERE e.patient_id=$1) AS submissions,
    (SELECT count(*)::int FROM kinesiology_evolution_validation_reviews r JOIN kinesiology_evolutions e ON e.id=r.evolution_id WHERE e.patient_id=$1) AS reviews,
    (SELECT count(*)::int FROM kinesiology_evolution_correction_requests c JOIN kinesiology_evolutions e ON e.id=c.evolution_id WHERE e.patient_id=$1) AS corrections,
    (SELECT count(*)::int FROM kinesiology_evolution_amendment_links l JOIN kinesiology_evolutions e ON e.id=l.original_evolution_id WHERE e.patient_id=$1) AS amendments`, [patient]);
  return rows[0];
}

before(async () => {
  if (!selected) return;
  try {
    // This read-only identity + full empty-baseline check must precede every fixture connection.
    const target = await verifyDisposableIntegrationTarget();
    const options = '-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000';
    assert.equal(process.env.DATABASE_URL, process.env.DISPOSABLE_INTEGRATION_DATABASE_URL,
      'fixture pool uses only the runner-injected verified target binding');
    ({ default: config } = await import('../../src/config.ts'));
    ({ JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
    ({ cleanDb } = await import('./helpers/clean-db.js'));
    const { createApp } = await import('../../src/app.ts');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, application_name: 'kinesiology-evolutions-integration',
      max: 12, connectionTimeoutMillis: timeout, statement_timeout: timeout, query_timeout: timeout + 1000,
      lock_timeout: timeout, idle_in_transaction_session_timeout: timeout, options });
    const { rows } = await pool.query('SELECT name FROM public.schema_migrations ORDER BY name');
    assert.equal(rows.length, 35, 'all migrations through 035 must be present');
    assert.equal(target.databaseName, new URL(process.env.DATABASE_URL).pathname.slice(1));
    cleanupAuthorized = true;
    await cleanDb(pool);
    server = createApp(pool).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  } catch (error) {
    throw new Error(`disposable integration setup failed: ${safeError(error)}`);
  }
}, { timeout: 30000 });

after(async () => {
  const errors = [];
  if (pool && cleanupAuthorized) {
    try {
      await cleanDb(pool);
      // Post-cleanup read-only verification proves the target identity and full empty baseline again.
      await verifyDisposableIntegrationTarget();
    } catch (error) { errors.push(new Error(`guarded fixture cleanup failed: ${safeError(error)}`)); }
  }
  if (server) try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  catch (error) { errors.push(new Error(`HTTP server close failed: ${safeError(error)}`)); }
  if (pool) try { await pool.end(); } catch (error) { errors.push(new Error(`pool close failed: ${safeError(error)}`)); }
  if (errors.length) throw new AggregateError(errors, 'evolutions integration teardown failed');
}, { timeout: 30000 });

test('evolutions preserve immutable versions, authorization privacy, SQL constraints and guarded concurrency',
  { skip: !selected, timeout: 120000 }, async () => {
    const f = await fixture();
    const studentJwt = await token(f.student), teacherJwt = await token(f.teacher);
    const otherStudentJwt = await token(f.otherStudent), otherTeacherJwt = await token(f.otherTeacher);
    const adminJwt = await token(f.admin);
    const evaluation = await validEvaluation(f, studentJwt, teacherJwt);
    const otherContext = { ...f, origin: f.other, period: f.otherPeriod, student: f.otherStudent, teacher: f.otherTeacher };
    const otherEvaluation = await validEvaluation(otherContext, otherStudentJwt, otherTeacherJwt);
    const otherContextDraft = await createEvolution(otherContext, otherEvaluation, otherStudentJwt, evolutionContent());
    assert.equal(otherContextDraft.status, 201, 'second care context has a real same-patient evolution');

    const spoofedDraft = await request('POST', '/kinesiology-evolutions', studentJwt, {
      patient_id: f.patient, evaluation_id: evaluation.id, subject_id: f.origin.subject,
      academic_group_id: f.origin.group, content: {}, author_id: f.otherStudent.id,
    });
    assert.equal(spoofedDraft.status, 400, 'body cannot spoof authenticated authorship');
    const draft = await createEvolution(f, evaluation, studentJwt);
    assert.equal(draft.status, 201);
    assert.equal(draft.body.status, 'draft');
    const beforeIncomplete = await publicState(studentJwt, f.patient, [draft.body.id]);
    const incomplete = await request('POST', `/kinesiology-evolutions/${draft.body.id}/submissions`, studentJwt, {});
    assert.equal(incomplete.status, 400);
    assert.deepEqual(await publicState(studentJwt, f.patient, [draft.body.id]), beforeIncomplete,
      'rejected incomplete submission leaves public detail, list, history, and corrections unchanged');
    const prose = evolutionContent();
    const edited = await request('PATCH', `/kinesiology-evolutions/${draft.body.id}`, studentJwt, { content: prose });
    assert.equal(edited.status, 200);
    const first = await request('POST', `/kinesiology-evolutions/${draft.body.id}/submissions`, studentJwt, {});
    assert.equal(first.status, 201);
    assert.deepEqual(first.body.content, prose);
    assert.equal(first.body.submitted_by, f.student.id);
    assert.equal((await request('PATCH', `/kinesiology-evolutions/${draft.body.id}`, studentJwt, { content: prose })).status, 409);
    const firstSnapshot = await pool.query('SELECT clinical_content FROM kinesiology_evolution_submissions WHERE id=$1', [first.body.id]);
    assert.deepEqual(firstSnapshot.rows[0].clinical_content, prose);

    const reason = 'Please clarify the treatment sequence';
    const correction = await request('POST', `/kinesiology-evolutions/${draft.body.id}/corrections`, teacherJwt,
      { submission_id: first.body.id, reason });
    assert.equal(correction.status, 201);
    const changed = evolutionContent({ current_status: 'Stable with residual stiffness' });
    assert.equal((await request('PATCH', `/kinesiology-evolutions/${draft.body.id}`, studentJwt, { content: changed })).status, 200);
    const second = await request('POST', `/kinesiology-evolutions/${draft.body.id}/submissions`, studentJwt, {});
    assert.equal(second.status, 201);
    assert.equal(second.body.ordinal, '2');
    assert.deepEqual(second.body.content, changed);
    const beforeStaleReview = await publicState(studentJwt, f.patient, [draft.body.id]);
    const staleReview = await request('POST', `/kinesiology-evolutions/${draft.body.id}/validations`, teacherJwt,
      { submission_id: first.body.id });
    assert.equal(staleReview.status, 409, 'stale first submission must not validate');
    assert.deepEqual(await publicState(studentJwt, f.patient, [draft.body.id]), beforeStaleReview,
      'stale review rejection preserves current public version and history');
    const secondCorrectionReason = 'Keep this rationale private during revision';
    const secondCorrection = await request('POST', `/kinesiology-evolutions/${draft.body.id}/corrections`, teacherJwt,
      { submission_id: second.body.id, reason: secondCorrectionReason });
    assert.equal(secondCorrection.status, 201);
    const privateRevision = evolutionContent({ current_status: 'Private unsubmitted revision after correction' });
    assert.equal((await request('PATCH', `/kinesiology-evolutions/${draft.body.id}`, studentJwt,
      { content: privateRevision })).status, 200);
    const crossContextDetailDuringCorrection = await request('GET', `/kinesiology-evolutions/${draft.body.id}`, otherStudentJwt);
    assert.equal(crossContextDetailDuringCorrection.status, 200);
    assert.equal(crossContextDetailDuringCorrection.body.status, 'submitted');
    assert.deepEqual(crossContextDetailDuringCorrection.body.content, changed);
    assert.equal(crossContextDetailDuringCorrection.body.submission_id, second.body.id);
    assert.equal(crossContextDetailDuringCorrection.body.updated_at, second.body.submitted_at);
    const crossContextListDuringCorrection = await request('GET', `/kinesiology-evolutions?patient_id=${f.patient}`, otherStudentJwt);
    const projectedDuringCorrection = crossContextListDuringCorrection.body.items.find(item => item.id === draft.body.id);
    assert.deepEqual(projectedDuringCorrection.content, changed);
    assert.equal(projectedDuringCorrection.updated_at, second.body.submitted_at);
    const crossContextHistoryDuringCorrection = await request('GET', `/kinesiology-evolutions/${draft.body.id}/submissions`, otherStudentJwt);
    assert.equal(crossContextHistoryDuringCorrection.body.items.length, 1);
    assert.equal(crossContextHistoryDuringCorrection.body.items[0].id, second.body.id,
      'older submission is hidden during correction of the latest snapshot');
    const teacherDetailDuringCorrection = await request('GET', `/kinesiology-evolutions/${draft.body.id}`, otherTeacherJwt);
    const teacherListDuringCorrection = await request('GET', `/kinesiology-evolutions?patient_id=${f.patient}`, otherTeacherJwt);
    const teacherHistoryDuringCorrection = await request('GET', `/kinesiology-evolutions/${draft.body.id}/submissions`, otherTeacherJwt);
    assert.equal(teacherDetailDuringCorrection.body.submission_id, second.body.id);
    assert.deepEqual(teacherDetailDuringCorrection.body.content, changed);
    assert.equal(teacherDetailDuringCorrection.body.updated_at, second.body.submitted_at);
    assert.deepEqual(teacherListDuringCorrection.body.items.find(item => item.id === draft.body.id).content, changed);
    assert.equal(teacherHistoryDuringCorrection.body.items.length, 1);
    assert.equal(teacherHistoryDuringCorrection.body.items[0].id, second.body.id);
    const crossContextProjection = JSON.stringify([crossContextDetailDuringCorrection, crossContextListDuringCorrection,
      crossContextHistoryDuringCorrection, teacherDetailDuringCorrection, teacherListDuringCorrection,
      teacherHistoryDuringCorrection]);
    assert.equal(crossContextProjection.includes(privateRevision.current_status), false);
    assert.equal(crossContextProjection.includes(reason), false);
    assert.equal(crossContextProjection.includes(correction.body.requested_at), false);
    assert.equal(crossContextProjection.includes(secondCorrectionReason), false);
    assert.equal(crossContextProjection.includes(secondCorrection.body.requested_at), false,
      'correction reasons and audit timestamps are private across care contexts');
    assert.equal((await request('GET', `/kinesiology-evolutions/${draft.body.id}/corrections`, otherStudentJwt)).status, 404);
    assert.equal((await request('GET', `/kinesiology-evolutions/${draft.body.id}/corrections`, otherTeacherJwt)).status, 404);
    const third = await request('POST', `/kinesiology-evolutions/${draft.body.id}/submissions`, studentJwt, {});
    assert.equal(third.status, 201);
    assert.equal(third.body.ordinal, '3');
    assert.deepEqual(third.body.content, privateRevision);
    const validated = await request('POST', `/kinesiology-evolutions/${draft.body.id}/validations`, teacherJwt,
      { submission_id: third.body.id });
    assert.equal(validated.status, 201);
    assert.equal((await request('PATCH', `/kinesiology-evolutions/${draft.body.id}`, studentJwt, { content: prose })).status, 409);
    const originalDetail = await request('GET', `/kinesiology-evolutions/${draft.body.id}`, studentJwt);
    const originalHistory = await request('GET', `/kinesiology-evolutions/${draft.body.id}/submissions`, studentJwt);
    const originalCorrections = await request('GET', `/kinesiology-evolutions/${draft.body.id}/corrections`, studentJwt);
    assert.equal(originalDetail.body.status, 'validated');
    assert.equal(originalHistory.body.items.length, 3);
    assert.deepEqual(originalHistory.body.items.map(item => item.id), [first.body.id, second.body.id, third.body.id]);
    assert.equal(originalCorrections.body.items.length, 2);
    assert.deepEqual(originalCorrections.body.items.map(item => item.reason), [reason, secondCorrectionReason]);
    assert.equal(originalDetail.body.reviewed_by, f.teacher.id);

    const amendment = await request('POST', `/kinesiology-evolutions/${draft.body.id}/amendments`, studentJwt, {});
    assert.equal(amendment.status, 201);
    assert.equal(amendment.body.amendment_of_evolution_id, draft.body.id);
    const amendmentContent = evolutionContent({ current_status: 'New symptom after treatment' });
    assert.equal((await request('PATCH', `/kinesiology-evolutions/${amendment.body.id}`, studentJwt, { content: amendmentContent })).status, 200);
    const amendmentSubmit1 = await request('POST', `/kinesiology-evolutions/${amendment.body.id}/submissions`, studentJwt, {});
    assert.equal(amendmentSubmit1.status, 201);
    assert.equal(amendmentSubmit1.body.ordinal, '1');
    assert.equal((await request('POST', `/kinesiology-evolutions/${amendment.body.id}/corrections`, teacherJwt,
      { submission_id: amendmentSubmit1.body.id, reason: 'Clarify the change' })).status, 201);
    const correctedAmendment = evolutionContent({ current_status: 'Symptom monitored; treatment adjusted' });
    assert.equal((await request('PATCH', `/kinesiology-evolutions/${amendment.body.id}`, studentJwt, { content: correctedAmendment })).status, 200);
    const amendmentSubmit2 = await request('POST', `/kinesiology-evolutions/${amendment.body.id}/submissions`, studentJwt, {});
    assert.equal(amendmentSubmit2.status, 201);
    assert.equal(amendmentSubmit2.body.ordinal, '2');
    const amendmentValidated = await request('POST', `/kinesiology-evolutions/${amendment.body.id}/validations`, teacherJwt,
      { submission_id: amendmentSubmit2.body.id });
    assert.equal(amendmentValidated.status, 201);
    assert.equal(amendmentValidated.body.reviewed_by, f.teacher.id);
    assert.equal((await request('GET', `/kinesiology-evolutions/${amendment.body.id}`, studentJwt)).body.status, 'validated');
    assert.deepEqual((await request('GET', `/kinesiology-evolutions/${draft.body.id}`, studentJwt)).body, originalDetail.body);
    assert.deepEqual((await request('GET', `/kinesiology-evolutions/${draft.body.id}/submissions`, studentJwt)).body, originalHistory.body);
    assert.deepEqual((await request('GET', `/kinesiology-evolutions/${draft.body.id}/corrections`, studentJwt)).body,
      originalCorrections.body, 'child correction lifecycle preserves all original correction metadata exactly');

    const beforeInvalid = await baselineCounts(f.patient);
    const probe = await pool.connect();
    let transactionStarted = false;
    try {
      const evolutionFk = await fkConstraintName(probe, 'kinesiology_evolutions',
        ['evaluation_id', 'clinical_record_id', 'patient_id'], 'kinesiology_evaluations',
        ['id', 'clinical_record_id', 'patient_id']);
      const reviewFk = await fkConstraintName(probe, 'kinesiology_evolution_validation_reviews',
        ['submission_id', 'evolution_id'], 'kinesiology_evolution_submissions', ['id', 'evolution_id']);
      const amendmentOriginFk = await fkConstraintName(probe, 'kinesiology_evolution_amendment_links',
        ['original_evolution_id', 'evaluation_id', 'clinical_record_id', 'patient_id', 'origin_subject_id', 'origin_group_id'],
        'kinesiology_evolutions', ['id', 'evaluation_id', 'clinical_record_id', 'patient_id', 'origin_subject_id', 'origin_group_id']);
      const selfLinkCheck = await checkConstraintName(probe, 'kinesiology_evolution_amendment_links',
        'amendment_evolution_id <> original_evolution_id');
      const unlinkedChild = await probe.query('SELECT count(*)::int AS count FROM kinesiology_evolution_amendment_links WHERE amendment_evolution_id=$1',
        [otherContextDraft.body.id]);
      assert.equal(unlinkedChild.rows[0].count, 0, 'invalid context probe child has no competing amendment link');
      await probe.query('BEGIN');
      transactionStarted = true;
      await expectConstraint(probe, 'invalid_evolution_fk', `INSERT INTO kinesiology_evolutions
        (clinical_record_id,patient_id,evaluation_id,author_id,origin_student_habilitation_id,origin_subject_id,origin_group_id,content)
        SELECT clinical_record_id,patient_id,9223372036854775000,author_id,origin_student_habilitation_id,origin_subject_id,origin_group_id,'{}'::jsonb
        FROM kinesiology_evolutions WHERE id=$1`, [draft.body.id], '23503', evolutionFk);
      const teacherHabilitation = (await probe.query(`SELECT th.id FROM teacher_academic_habilitations th
        JOIN teachers t ON t.id=th.teacher_id WHERE t.user_id=$1 AND th.subject_id=$2 AND th.academic_group_id=$3
          AND th.revoked_at IS NULL`, [f.teacher.id, f.origin.subject, f.origin.group])).rows[0];
      assert.ok(teacherHabilitation, 'active origin teacher context exists for invalid review probe');
      await expectConstraint(probe, 'invalid_review_fk', `INSERT INTO kinesiology_evolution_validation_reviews
        (evolution_id,submission_id,reviewed_by,teacher_habilitation_id) VALUES ($1,9223372036854775000,$2,$3)`,
      [draft.body.id, f.teacher.id, teacherHabilitation.id], '23503', reviewFk);
      await expectConstraint(probe, 'self_amendment', `INSERT INTO kinesiology_evolution_amendment_links
        (amendment_evolution_id,original_evolution_id,evaluation_id,clinical_record_id,patient_id,origin_subject_id,origin_group_id)
        SELECT id,id,evaluation_id,clinical_record_id,patient_id,origin_subject_id,origin_group_id
        FROM kinesiology_evolutions WHERE id=$1`, [draft.body.id], '23514', selfLinkCheck);
      await expectConstraint(probe, 'mismatched_context', `INSERT INTO kinesiology_evolution_amendment_links
        (amendment_evolution_id,original_evolution_id,evaluation_id,clinical_record_id,patient_id,origin_subject_id,origin_group_id)
        SELECT child.id,parent.id,child.evaluation_id,child.clinical_record_id,child.patient_id,child.origin_subject_id,child.origin_group_id
        FROM kinesiology_evolutions child,kinesiology_evolutions parent WHERE child.id=$1 AND parent.id=$2`,
      [otherContextDraft.body.id, draft.body.id], '23503', amendmentOriginFk);
      await probe.query('ROLLBACK');
      transactionStarted = false;
    } finally {
      if (transactionStarted) { try { await probe.query('ROLLBACK'); } catch {} }
      probe.release();
    }
    assert.deepEqual(await baselineCounts(f.patient), beforeInvalid, 'savepoint probes preserve all clinical rows and logical counters');

    const listed = await request('GET', `/kinesiology-evolutions?patient_id=${f.patient}`, studentJwt);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 2);
    const crossContextDetail = await request('GET', `/kinesiology-evolutions/${draft.body.id}`, otherStudentJwt);
    assert.equal(crossContextDetail.status, 200, 'active second care context sees only submitted work');
    assert.equal(crossContextDetail.body.submission_id, third.body.id);
    assert.equal(crossContextDetail.body.content.current_status, privateRevision.current_status);
    const crossContextHistory = await request('GET', `/kinesiology-evolutions/${draft.body.id}/submissions`, otherStudentJwt);
    assert.equal(crossContextHistory.status, 200);
    assert.equal(crossContextHistory.body.items.length, 1, 'cross-context history reveals only the latest submission');
    assert.equal(crossContextHistory.body.items[0].id, third.body.id);
    assert.equal(JSON.stringify(crossContextHistory.body).includes(reason), false);
    assert.equal((await request('GET', `/kinesiology-evolutions/${draft.body.id}/corrections`, otherStudentJwt)).status, 404,
      'cross-context reader cannot access private correction reasons');
    assert.equal((await request('GET', `/kinesiology-evolutions/${draft.body.id}`, adminJwt)).status, 403, 'admin receives no clinical bypass');
    const hiddenDraft = await request('POST', `/kinesiology-evolutions/${draft.body.id}/amendments`, studentJwt, {});
    assert.equal(hiddenDraft.status, 201);
    assert.equal(hiddenDraft.body.status, 'draft');
    assert.equal((await request('GET', `/kinesiology-evolutions/${hiddenDraft.body.id}`, otherTeacherJwt)).status, 404,
      'never-submitted amendment is hidden from other-context teacher');
    assert.equal((await request('GET', `/kinesiology-evolutions/${hiddenDraft.body.id}`, otherStudentJwt)).status, 404,
      'never-submitted amendment is hidden from other-context student');
    const beforeContextRevocation = await publicState(teacherJwt, f.patient, [draft.body.id, hiddenDraft.body.id]);
    await pool.query(`UPDATE student_academic_habilitations SET revoked_by=$2,revoked_at=clock_timestamp()
      WHERE id=$1`, [f.otherPeriod, f.admin.id]);
    assert.equal((await request('GET', `/kinesiology-evolutions/${draft.body.id}`, otherStudentJwt)).status, 404,
      'revoked cross-context student is denied');
    const renewedOther = await renewStudentPeriod(f, f.otherPeriod, f.otherStudent.id, f.other, f.otherTeacher.id, f.admin.id);
    f.otherPeriod = renewedOther.period;
    assert.equal((await request('GET', `/kinesiology-evolutions/${draft.body.id}`, otherStudentJwt)).status, 200,
      'new audited period and matching assignment restore legitimate cross-context access');
    await pool.query(`UPDATE teacher_academic_habilitations SET revoked_by=$2,revoked_at=clock_timestamp()
      WHERE teacher_id=(SELECT id FROM teachers WHERE user_id=$1) AND revoked_at IS NULL`, [f.otherTeacher.id, f.admin.id]);
    assert.equal((await request('GET', `/kinesiology-evolutions/${draft.body.id}`, otherTeacherJwt)).status, 404,
      'revoked cross-context teacher is denied');
    assert.deepEqual(await publicState(teacherJwt, f.patient, [draft.body.id, hiddenDraft.body.id]), beforeContextRevocation,
      'revoked-context reads do not alter public detail, list, history, or corrections');
    const forged = await request('POST', `/kinesiology-evolutions/${hiddenDraft.body.id}/submissions`, studentJwt,
      { submitted_by: f.otherStudent.id, submitted_at: '2000-01-01T00:00:00Z' });
    assert.equal(forged.status, 400);

    // Latest submission projections must not expose the correction reason or audit prose.
    const publicSnapshot = JSON.stringify([listed.body, originalDetail.body, originalHistory.body]);
    assert.equal(publicSnapshot.includes(reason), false);
    const snapshotOnly = await request('GET', `/kinesiology-evolutions/${draft.body.id}`, teacherJwt);
    assert.equal(snapshotOnly.body.content.current_status, privateRevision.current_status);
    assert.equal(snapshotOnly.body.submission_id, third.body.id);

    // Both public validation requests target the same eligible submission; only one may win.
    const raceDraft = await createEvolution(f, evaluation, studentJwt, evolutionContent());
    assert.equal(raceDraft.status, 201);
    const raceSubmission = await request('POST', `/kinesiology-evolutions/${raceDraft.body.id}/submissions`, studentJwt, {});
    assert.equal(raceSubmission.status, 201);
    const race = await Promise.all([
      request('POST', `/kinesiology-evolutions/${raceDraft.body.id}/validations`, teacherJwt, { submission_id: raceSubmission.body.id }),
      request('POST', `/kinesiology-evolutions/${raceDraft.body.id}/validations`, teacherJwt, { submission_id: raceSubmission.body.id }),
    ]);
    assert.deepEqual(race.map(result => result.status).sort(), [201, 409]);
    const racedHistory = await request('GET', `/kinesiology-evolutions/${raceDraft.body.id}/submissions`, studentJwt);
    assert.equal(racedHistory.status, 200);
    assert.equal(racedHistory.body.items.length, 1);
    assert.equal(racedHistory.body.items[0].reviewed_by, f.teacher.id,
      'public history exposes exactly the winning validation review');
    assert.equal((await request('GET', `/kinesiology-evolutions/${raceDraft.body.id}`, studentJwt)).body.status, 'validated');

    const beforeUnauthorized = await publicState(teacherJwt, f.patient, [draft.body.id, raceDraft.body.id]);
    const unauthorizedReview = await request('POST', `/kinesiology-evolutions/${draft.body.id}/validations`, otherTeacherJwt,
      { submission_id: third.body.id });
    assert.equal(unauthorizedReview.status, 404);
    assert.deepEqual(await publicState(teacherJwt, f.patient, [draft.body.id, raceDraft.body.id]), beforeUnauthorized,
      'unauthorized review leaves public list, detail, history, and correction state unchanged');

    // Former student authorship does not block the still-authorized origin teacher after reassignment.
    const reassigned = await createEvolution(f, evaluation, studentJwt, evolutionContent({ current_status: 'Submitted before reassignment' }));
    assert.equal(reassigned.status, 201);
    const formerAuthorSubmission = await request('POST', `/kinesiology-evolutions/${reassigned.body.id}/submissions`, studentJwt, {});
    assert.equal(formerAuthorSubmission.status, 201);
    await pool.query(`UPDATE patient_assignments SET ended_by=$2,ended_at=clock_timestamp()
      WHERE id=$1`, [f.originAssignmentId, f.teacher.id]);
    assert.equal((await request('GET', `/kinesiology-evolutions/${reassigned.body.id}`, studentJwt)).status, 404,
      'former author loses access after assignment ends');
    const originReview = await request('POST', `/kinesiology-evolutions/${reassigned.body.id}/validations`, teacherJwt,
      { submission_id: formerAuthorSubmission.body.id });
    assert.equal(originReview.status, 201, 'origin teacher may finish review after reassignment');
    assert.equal((await request('GET', `/kinesiology-evolutions/${reassigned.body.id}`, teacherJwt)).body.status, 'validated');
    assert.equal((await request('GET', `/kinesiology-evolutions/${reassigned.body.id}`, adminJwt)).status, 403,
      'no administrator bypass after reassignment');
    const replacement = await addStudentPeriod(f, f.otherStudent.id, f.origin, f.teacher.id);
    const replacementAmendment = await request('POST', `/kinesiology-evolutions/${draft.body.id}/amendments`, otherStudentJwt, {});
    assert.equal(replacementAmendment.status, 201, 'replacement author uses a renewed active origin-context period and assignment');
    assert.equal(replacementAmendment.body.author_id, f.otherStudent.id);
    assert.equal(replacementAmendment.body.origin_student_habilitation_id, replacement.period);
    assert.equal(replacementAmendment.body.amendment_of_evolution_id, draft.body.id);
    assert.deepEqual(replacementAmendment.body.content, privateRevision,
      'replacement-authored amendment starts from the immutable validated snapshot');
    assert.equal((await request('GET', `/kinesiology-evolutions/${reassigned.body.id}`, studentJwt)).status, 404,
      'replacement access does not restore former-author access');
  });
