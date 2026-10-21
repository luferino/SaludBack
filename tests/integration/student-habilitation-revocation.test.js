import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';
import config from '../../src/config.ts';
import { cleanDb } from './helpers/clean-db.js';
import { createApp } from '../../src/app.ts';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';

const APP_NAME = 'student-habilitation-revocation-integration';
const TIMEOUT = 5000;
const MIGRATIONS = Array.from({ length: 21 }, (_, i) => `${String(i + 1).padStart(3, '0')}_${[
  'create_users.sql', 'create_patients.sql', 'add_email_and_reset_tokens.sql', 'multi_role_and_audit.sql',
  'user_id_unique_profiles.sql', 'create_permission_matrix.sql', 'seed_permission_matrix.sql',
  'create_clinical_records.sql', 'create_academic_contexts.sql', 'create_academic_habilitations.sql',
  'seed_subject_permissions.sql', 'seed_group_permissions.sql', 'seed_subject_group_permissions.sql',
  'seed_teacher_habilitation_permissions.sql', 'seed_teacher_habilitation_revocation_permission.sql',
  'seed_student_habilitation_permissions.sql', 'create_patient_assignments.sql',
  'seed_patient_assignment_permissions.sql', 'seed_student_habilitation_revocation_permission.sql',
  'create_kinesiology_evaluations.sql', 'seed_kinesiology_evaluation_permissions.sql',
][i]}`);
let pool, server, baseUrl, safeToClean = false;
function normalize(value) { const ip = value?.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase(); return ip?.startsWith('::ffff:') ? ip.slice(7) : ip; }
function loopback(value) { const ip = normalize(value); return ip && (net.isIP(ip) === 4 ? ip.startsWith('127.') : ip === '::1'); }
async function verifyTarget() {
  const value = readFileSync('.env.test', 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^("|')(.*)\1$/, '$2');
  assert.ok(value && process.env.DATABASE_URL === value, 'effective DATABASE_URL must exactly match .env.test');
  const url = new URL(value); assert.ok(url.hostname === 'localhost' && url.port === '5432' && decodeURIComponent(url.pathname.slice(1)) === 'saludback_test' && !url.search && !url.hash);
  assert.ok(url.username && url.password); assert.doesNotMatch(process.env.NODE_ENV ?? '', /production/i); assert.doesNotMatch(process.env.APP_ENV ?? '', /production/i);
  const addresses = await dns.lookup(url.hostname, { all: true }); assert.ok(addresses.length && addresses.every(row => loopback(row.address)));
  const client = new pg.Client({ connectionString: value, connectionTimeoutMillis: TIMEOUT, statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 1000, options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000' });
  try {
    await client.connect(); await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`SELECT current_database() db,current_user usr,inet_server_addr()::text server,inet_server_port() port,inet_client_addr()::text peer,current_setting('transaction_read_only') ro`);
    assert.equal(rows[0].db, 'saludback_test'); assert.ok(rows[0].usr === decodeURIComponent(url.username), 'connected PostgreSQL role matches configured test URL'); assert.equal(Number(rows[0].port), 5432); assert.equal(rows[0].ro, 'on');
    assert.ok(addresses.some(row => normalize(row.address) === normalize(rows[0].server)));
    for (const peer of [rows[0].server, rows[0].peer, client.connection.stream.remoteAddress, client.connection.stream.localAddress]) assert.ok(loopback(peer));
    await client.query('ROLLBACK');
    const { rows: ledger } = await client.query('SELECT name FROM public.schema_migrations ORDER BY name'); assert.deepEqual(ledger.map(row => row.name), MIGRATIONS);
    const { rows: permission } = await client.query("SELECT permission,enforced FROM public.permissions WHERE permission='student-habilitations:revoke'"); assert.deepEqual(permission, [{ permission: 'student-habilitations:revoke', enforced: true }]);
    const { rows: grants } = await client.query("SELECT role,permission FROM public.role_permissions WHERE permission='student-habilitations:revoke' ORDER BY role"); assert.deepEqual(grants, [{ role: 'teacher', permission: 'student-habilitations:revoke' }]);
    const { rows: baseline } = await client.query(`SELECT
      (SELECT count(*)::int FROM public.patient_assignments) assignments,
      (SELECT count(*)::int FROM public.student_academic_habilitations) student_periods,
      (SELECT count(*)::int FROM public.teacher_academic_habilitations) teacher_periods,
      (SELECT count(*)::int FROM public.patients) patients,
      (SELECT count(*)::int FROM public.users) users,
      (SELECT count(*)::int FROM public.permissions) permissions,
      (SELECT count(*)::int FROM public.role_permissions) grants`);
    assert.deepEqual(baseline[0], { assignments: 0, student_periods: 0, teacher_periods: 0, patients: 0, users: 0, permissions: 25, grants: 32 });
    console.log('Verified disposable localhost:5432/saludback_test; migration ledger, exact permission baseline and empty fixtures confirmed.');
  } finally { await client.end(); }
  return value;
}
function name(prefix) { return `${prefix}${process.pid}${Math.random().toString(16).slice(2)}`; }
async function fixture({ withAssignment = false } = {}) {
  const { rows: users } = await pool.query("INSERT INTO users(username,password_hash,role) VALUES ($1,'unused','admin'),($2,'unused','teacher'),($3,'unused','teacher'),($4,'unused','estudiante'),($5,'unused','estudiante') RETURNING id,role,username", [name('a'), name('t'), name('t2'), name('s'), name('s2')]);
  const admin = users[0], teacher = users[1], secondTeacher = users[2], student = users[3], targetStudentUser = users[4];
  const { rows: teachers } = await pool.query('INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,$2,$3),($4,$5,$6) RETURNING id,user_id', [teacher.id,'Teacher','One',secondTeacher.id,'Teacher','Two']);
  const { rows: students } = await pool.query('INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,$2,$3,$4),($5,$6,$7,$8) RETURNING id', [student.id,'Student','Fixture',name('STU'),targetStudentUser.id,'Student','Target',name('STU')]);
  const { rows: subjects } = await pool.query('INSERT INTO subjects(name) VALUES ($1) RETURNING id', [name('subject')]);
  const { rows: groups } = await pool.query('INSERT INTO academic_groups(academic_year,curriculum_semester,name) VALUES (2098,1,$1) RETURNING id', [name('group')]);
  const subject = subjects[0].id, group = groups[0].id;
  await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id) VALUES ($1,$2)', [subject,group]);
  for (const t of teachers) await pool.query('INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp())', [t.id,subject,group,admin.id]);
  const { rows: periods } = await pool.query('INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id', [students[0].id,subject,group,admin.id]);
  const { rows: patients } = await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion) VALUES ($1,'Patient','Fixture','2000-01-01',$2,'00000000','F','Fixture') RETURNING id`, [String(Math.floor(Math.random()*80000000)+10000000),`${name('patient')}@example.test`]);
  if (withAssignment) await pool.query('INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by) VALUES ($1,$2,$3,$4)', [patients[0].id,periods[0].id,subject,teacher.id]);
  return { admin, teacher, secondTeacher, student, studentId: students[0].id, targetStudentId: students[1].id, period: periods[0].id, subject, group, patient: patients[0].id };
}
async function token(user) { return new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid, previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn }).sign({ role: user.role, sub: user.id, username: user.username }); }
async function request(path, jwt, body = {}) { const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) }); return { status: response.status, body: await response.json() }; }
async function waitForLocks(fragment, expected = 2) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query("SELECT count(*)::int count FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND state='active' AND wait_event_type='Lock' AND query ILIKE $2", [APP_NAME, `%${fragment}%`]);
    if (rows[0].count >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${expected} observed locks on ${fragment}`);
}

before(async () => {
  const databaseUrl = await verifyTarget();
  for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('PG') || key.toUpperCase() === 'NODE_PG_FORCE_NATIVE') delete process.env[key];
  process.env.DATABASE_URL = databaseUrl; process.env.PGOPTIONS = '-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000'; process.env.JWT_PREVIOUS_SECRETS ??= '[]'; process.env.PORT = '0';
  pool = new pg.Pool({ connectionString: databaseUrl, application_name: APP_NAME, max: 8, connectionTimeoutMillis: TIMEOUT, statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 1000, lock_timeout: TIMEOUT, idle_in_transaction_session_timeout: TIMEOUT, options: process.env.PGOPTIONS });
  const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name'); assert.deepEqual(rows.map(row => row.name), MIGRATIONS); safeToClean = true; await cleanDb(pool);
  server = createApp(pool).listen(0, '127.0.0.1'); await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); }); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { if (safeToClean) await cleanDb(pool); });
after(async () => {
  const errors = [];
  if (pool && safeToClean) try { await cleanDb(pool); const { rows } = await pool.query('SELECT count(*)::int users FROM users'); assert.equal(rows[0].users, 0); } catch (error) { errors.push(error); }
  if (server) try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch (error) { errors.push(error); }
  if (pool) try { await pool.end(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'student revocation integration cleanup failed');
});

test('revocation is exact-period, repeat-safe across actors, and reactivation does not restore history', async () => {
  const f = await fixture({ withAssignment: true }); const owner = await token(f.teacher); const second = await token(f.secondTeacher);
  const first = await request(`/student-habilitations/${f.period}/revoke`, owner, { revoked_by: f.admin.id }); assert.equal(first.status, 200); assert.equal(first.body.revoked_by, f.teacher.id); assert.ok(first.body.revoked_at);
  const again = await request(`/student-habilitations/${f.period}/revoke`, second); assert.equal(again.status, 200); assert.equal(again.body.revoked_by, first.body.revoked_by); assert.equal(again.body.revoked_at, first.body.revoked_at);
  const { rows: history } = await pool.query('SELECT student_habilitation_id,assigned_by,ended_by,ended_at,end_reason FROM patient_assignments WHERE patient_id=$1', [f.patient]); assert.equal(history.length,1); assert.equal(history[0].ended_by,f.teacher.id); assert.ok(history[0].ended_at); assert.equal(history[0].end_reason,null);
  const activation = await request('/student-habilitations', owner, { student_id:f.studentId, subject_id:f.subject, academic_group_id:f.group }); assert.equal(activation.status,201); assert.notEqual(activation.body.id,f.period);
  const { rows: rowsAfter } = await pool.query('SELECT student_habilitation_id,ended_at FROM patient_assignments WHERE patient_id=$1', [f.patient]); assert.equal(rowsAfter[0].student_habilitation_id,f.period); assert.ok(rowsAfter[0].ended_at);
});

test('create racing revocation serializes on teacher-context then exact-period locks', async () => {
  const f = await fixture(); const jwt = await token(f.teacher); const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM teacher_academic_habilitations WHERE subject_id=$1 AND academic_group_id=$2 FOR UPDATE', [f.subject,f.group]);
    const creating = request('/patient-assignments',jwt,{ patient_id:f.patient,student_habilitation_id:f.period,subject_id:f.subject,academic_group_id:f.group });
    const revoking = request(`/student-habilitations/${f.period}/revoke`,jwt);
    await waitForLocks('teacher_academic_habilitations'); await blocker.query('COMMIT');
    const [created, revoked] = await Promise.all([creating,revoking]); assert.ok([201,404].includes(created.status)); assert.equal(revoked.status,200);
    const { rows } = await pool.query('SELECT student_habilitation_id,assigned_by,ended_by,ended_at FROM patient_assignments WHERE patient_id=$1 ORDER BY id', [f.patient]);
    if (created.status === 201) {
      assert.equal(rows.length, 1); assert.equal(rows[0].student_habilitation_id, f.period); assert.equal(rows[0].assigned_by, f.teacher.id);
      assert.equal(rows[0].ended_by, f.teacher.id); assert.ok(rows[0].ended_at);
    } else assert.deepEqual(rows, []);
    const { rows: period } = await pool.query('SELECT revoked_by,revoked_at FROM student_academic_habilitations WHERE id=$1', [f.period]);
    assert.equal(period[0].revoked_by, f.teacher.id); assert.ok(period[0].revoked_at);
  } finally { try { await blocker.query('ROLLBACK'); } finally { blocker.release(); } }
});

test('reassignment racing revocation leaves no assignment active for the revoked period', async () => {
  const f = await fixture({ withAssignment:true }); const jwt = await token(f.teacher);
  const { rows: target } = await pool.query('INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id', [f.targetStudentId,f.subject,f.group,f.admin.id]);
  const { rows: assignment } = await pool.query('SELECT id::text id FROM patient_assignments WHERE patient_id=$1', [f.patient]); const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM teacher_academic_habilitations WHERE subject_id=$1 AND academic_group_id=$2 FOR UPDATE', [f.subject,f.group]);
    const moving = request(`/patient-assignments/${assignment[0].id}/reassign`,jwt,{ student_habilitation_id:target[0].id,subject_id:f.subject,academic_group_id:f.group });
    const revoking = request(`/student-habilitations/${f.period}/revoke`,jwt);
    await waitForLocks('teacher_academic_habilitations'); await blocker.query('COMMIT');
    const [moved, revoked] = await Promise.all([moving,revoking]); assert.ok([200,409].includes(moved.status)); assert.equal(revoked.status,200);
    const { rows } = await pool.query('SELECT student_habilitation_id,assigned_by,ended_by,ended_at,end_reason FROM patient_assignments WHERE patient_id=$1 ORDER BY id',[f.patient]);
    assert.equal(rows.filter(row => row.student_habilitation_id === f.period && row.ended_at === null).length, 0);
    assert.equal(rows[0].student_habilitation_id, f.period); assert.equal(rows[0].ended_by, f.teacher.id); assert.ok(rows[0].ended_at); assert.equal(rows[0].end_reason, null);
    if (moved.status === 200) {
      assert.equal(rows.length, 2); assert.equal(rows[1].student_habilitation_id, target[0].id); assert.equal(rows[1].assigned_by, f.teacher.id);
      assert.equal(rows[1].ended_at, null); assert.equal(rows[1].ended_by, null);
    } else assert.deepEqual(rows.map(row => row.student_habilitation_id), [f.period]);
    const { rows: period } = await pool.query('SELECT revoked_by,revoked_at FROM student_academic_habilitations WHERE id=$1', [f.period]);
    assert.equal(period[0].revoked_by, f.teacher.id); assert.ok(period[0].revoked_at);
  } finally { try { await blocker.query('ROLLBACK'); } finally { blocker.release(); } }
});
