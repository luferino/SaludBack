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

const evaluationContent = { admission_date: '2026-01-10', admission_status: 'Stable', illness_history: 'History', objectives: 'Goal', proposed_treatment: 'Plan' };
const evolutionContent = { session_date: '2026-02-28', current_status: 'Stable', objectives: 'Improve mobility', planned_treatment: 'Guided exercise' };
const evaluationNotFound = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } } };
const evolutionNotFound = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'evolution was not found' } } };

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

// One patient shared by a kinesiology origin context, a second kinesiology context and an odontology context.
async function fixture() {
  const { rows: users } = await pool.query(`INSERT INTO users(username,password_hash,role) VALUES
    ($1,'unused','admin'),($2,'unused','teacher'),($3,'unused','estudiante'),($4,'unused','estudiante'),
    ($5,'unused','teacher'),($6,'unused','estudiante'),($7,'unused','estudiante')
    RETURNING id,username,role`, [name('admin'), name('teacher'), name('student'), name('otherstudent'),
    name('odonteacher'), name('odonstudent'), name('stranger')]);
  const [admin, teacher, student, otherStudent, odontologyTeacher, odontologyStudent, stranger] = users;
  const careers = Object.fromEntries((await pool.query("SELECT code, id FROM careers WHERE code IN ('kinesiology','odontology')"))
    .rows.map(row => [row.code, row.id]));
  assert.ok(careers.kinesiology && careers.odontology, 'both careers are seeded by migration 036');
  const context = async career => {
    const subject = (await pool.query('INSERT INTO subjects(name,career_id) VALUES ($1,$2) RETURNING id', [name('subject'), career])).rows[0].id;
    const group = (await pool.query('INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,$1,$2) RETURNING id',
      [name('group'), career])).rows[0].id;
    await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) VALUES ($1,$2,$3)', [subject, group, career]);
    return { subject, group };
  };
  const origin = await context(careers.kinesiology);
  const other = await context(careers.kinesiology);
  const odontology = await context(careers.odontology);
  const [originTeacher, odontTeacher] = (await pool.query(`INSERT INTO teachers(user_id,nombres,apellidos) VALUES
    ($1,'Origin','Teacher'),($2,'Odontology','Teacher') RETURNING id`, [teacher.id, odontologyTeacher.id])).rows;
  const [originStudent, otherKinesiologyStudent, odontStudent] = (await pool.query(`INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES
    ($1,'Origin','Student',$2),($3,'Other','Student',$4),($5,'Odontology','Student',$6) RETURNING id`,
  [student.id, name('STU'), otherStudent.id, name('STU'), odontologyStudent.id, name('STU')])).rows;
  await pool.query(`INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$7,$4,clock_timestamp())`,
  [originTeacher.id, origin.subject, origin.group, admin.id, odontTeacher.id, odontology.subject, odontology.group]);
  const periods = (await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$7,$4,clock_timestamp()),($8,$9,$10,$4,clock_timestamp())
    RETURNING id,student_id`,
  [originStudent.id, origin.subject, origin.group, admin.id, otherKinesiologyStudent.id, other.subject, other.group,
    odontStudent.id, odontology.subject, odontology.group])).rows;
  const patient = (await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion)
    VALUES ($1,'Fixture','Patient','2000-02-29',$2,'00000000','F','Fixture address') RETURNING id`,
  [String(20000000 + serial), `${name('patient')}@example.test`])).rows[0].id;
  await pool.query(`INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by)
    VALUES ($1,$2,$3,$4),($1,$5,$6,$4),($1,$7,$8,$9)`,
  [patient, periods[0].id, origin.subject, teacher.id, periods[1].id, other.subject, periods[2].id, odontology.subject, odontologyTeacher.id]);
  return { admin, teacher, student, otherStudent, odontologyTeacher, odontologyStudent, stranger, patient, origin, other,
    odontology, careers, originStudent, odontStudent, originTeacher };
}

async function validatedEvaluation(f) {
  const studentJwt = await token(f.student), teacherJwt = await token(f.teacher);
  const created = await request('POST', '/kinesiology-evaluations', studentJwt, {
    patient_id: f.patient, subject_id: f.origin.subject, academic_group_id: f.origin.group, content: evaluationContent,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const consent = await request('POST', `/kinesiology-evaluations/${created.body.id}/consent`, teacherJwt, { paper_signature_date: '2026-01-12' });
  assert.equal(consent.status, 201, JSON.stringify(consent.body));
  const submitted = await request('POST', `/kinesiology-evaluations/${created.body.id}/submissions`, studentJwt, {});
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const validated = await request('POST', `/kinesiology-evaluations/${created.body.id}/validations`, teacherJwt,
    { submission_id: submitted.body.id });
  assert.equal(validated.status, 201, JSON.stringify(validated.body));
  return created.body.id;
}

async function submittedEvolution(f, evaluationId) {
  const studentJwt = await token(f.student);
  const created = await request('POST', '/kinesiology-evolutions', studentJwt, {
    patient_id: f.patient, evaluation_id: evaluationId, subject_id: f.origin.subject, academic_group_id: f.origin.group, content: evolutionContent,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const submitted = await request('POST', `/kinesiology-evolutions/${created.body.id}/submissions`, studentJwt, {});
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return created.body.id;
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
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, application_name: 'kinesiology-career-isolation-integration',
      max: 12, connectionTimeoutMillis: timeout, statement_timeout: timeout, query_timeout: timeout + 1000,
      lock_timeout: timeout, idle_in_transaction_session_timeout: timeout, options });
    const { rows } = await pool.query('SELECT name FROM public.schema_migrations ORDER BY name');
    assert.equal(rows.length, 45, 'all migrations through 045 must be present');
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
  if (errors.length) throw new AggregateError(errors, 'career isolation integration teardown failed');
}, { timeout: 30000 });

test('odontology-context student and teacher see kinesiology records of the shared patient exactly like a stranger',
  { skip: !selected, timeout: 120000 }, async () => {
    const f = await fixture();
    const evaluationId = await validatedEvaluation(f);
    const evolutionId = await submittedEvolution(f, evaluationId);
    for (const actor of [f.odontologyStudent, f.odontologyTeacher, f.stranger]) {
      const jwt = await token(actor);
      const detail = await request('GET', `/kinesiology-evaluations/${evaluationId}`, jwt);
      assert.deepEqual(detail, evaluationNotFound, `evaluation detail for ${actor.username}`);
      const history = await request('GET', `/kinesiology-evaluations/${evaluationId}/submissions`, jwt);
      assert.deepEqual(history, evaluationNotFound, `evaluation history for ${actor.username}`);
      const listing = await request('GET', `/kinesiology-evaluations?patient_id=${f.patient}`, jwt);
      assert.deepEqual(listing, { status: 200, body: { items: [] } }, `evaluation list for ${actor.username}`);
      const evolution = await request('GET', `/kinesiology-evolutions/${evolutionId}`, jwt);
      assert.deepEqual(evolution, evolutionNotFound, `evolution detail for ${actor.username}`);
      const evolutionHistory = await request('GET', `/kinesiology-evolutions/${evolutionId}/submissions`, jwt);
      assert.deepEqual(evolutionHistory, evolutionNotFound, `evolution history for ${actor.username}`);
      const evolutionListing = await request('GET', `/kinesiology-evolutions?patient_id=${f.patient}`, jwt);
      assert.deepEqual(evolutionListing, { status: 200, body: { items: [] } }, `evolution list for ${actor.username}`);
    }
  });

test('a kinesiology cross-context reader in another kinesiology subject still reads the latest snapshot',
  { skip: !selected, timeout: 120000 }, async () => {
    const f = await fixture();
    const evaluationId = await validatedEvaluation(f);
    const evolutionId = await submittedEvolution(f, evaluationId);
    const jwt = await token(f.otherStudent);
    const detail = await request('GET', `/kinesiology-evaluations/${evaluationId}`, jwt);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.validation_status, 'validated');
    const listing = await request('GET', `/kinesiology-evaluations?patient_id=${f.patient}`, jwt);
    assert.equal(listing.body.items.length, 1);
    const history = await request('GET', `/kinesiology-evaluations/${evaluationId}/submissions`, jwt);
    assert.equal(history.status, 200, JSON.stringify(history.body));
    assert.equal(history.body.items.length, 1);
    const evolution = await request('GET', `/kinesiology-evolutions/${evolutionId}`, jwt);
    assert.equal(evolution.status, 200, JSON.stringify(evolution.body));
    assert.equal(evolution.body.status, 'submitted');
  });

test('kinesiology creation in an odontology context is rejected and writes nothing',
  { skip: !selected, timeout: 120000 }, async () => {
    const f = await fixture();
    const jwt = await token(f.odontologyStudent);
    const before = await pool.query('SELECT count(*)::int AS count FROM kinesiology_evaluations WHERE patient_id = $1', [f.patient]);
    const evaluation = await request('POST', '/kinesiology-evaluations', jwt, {
      patient_id: f.patient, subject_id: f.odontology.subject, academic_group_id: f.odontology.group, content: evaluationContent,
    });
    assert.deepEqual(evaluation, { status: 403, body: { error: { code: 'FORBIDDEN', message: 'an active student context is required' } } });
    const evolution = await request('POST', '/kinesiology-evolutions', jwt, {
      patient_id: f.patient, evaluation_id: '9007199254740993', subject_id: f.odontology.subject,
      academic_group_id: f.odontology.group, content: evolutionContent,
    });
    assert.deepEqual(evolution, { status: 403, body: { error: { code: 'FORBIDDEN', message: 'an active student context is required' } } });
    const after = await pool.query('SELECT count(*)::int AS count FROM kinesiology_evaluations WHERE patient_id = $1', [f.patient]);
    assert.equal(after.rows[0].count, before.rows[0].count);
  });
