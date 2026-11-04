import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const TIMEOUT = 5000;
const APP_NAME = 'patient-availability-contract-integration';
const MIGRATIONS = ['create_users.sql','create_patients.sql','add_email_and_reset_tokens.sql','multi_role_and_audit.sql','user_id_unique_profiles.sql','create_permission_matrix.sql','seed_permission_matrix.sql','create_clinical_records.sql','create_academic_contexts.sql','create_academic_habilitations.sql','seed_subject_permissions.sql','seed_group_permissions.sql','seed_subject_group_permissions.sql','seed_teacher_habilitation_permissions.sql','seed_teacher_habilitation_revocation_permission.sql','seed_student_habilitation_permissions.sql','create_patient_assignments.sql','seed_patient_assignment_permissions.sql','seed_student_habilitation_revocation_permission.sql','create_kinesiology_evaluations.sql','seed_kinesiology_evaluation_permissions.sql','create_kinesiology_consent_attestations.sql','create_kinesiology_submissions.sql','create_kinesiology_correction_requests.sql','create_kinesiology_validation_reviews.sql','create_kinesiology_amendment_links.sql','seed_profile_read_permissions.sql','seed_habilitation_read_permissions.sql','create_patient_context_availabilities.sql','seed_patient_availability_permissions.sql','create_kinesiology_evolutions.sql','seed_kinesiology_evolution_permissions.sql','create_kinesiology_evolution_reviews.sql','seed_kinesiology_evolution_review_permissions.sql','create_kinesiology_evolution_amendment_links.sql'].map((file, i) => `${String(i + 1).padStart(3, '0')}_${file}`);
let pool, server, baseUrl, config, cleanDb, JwtTokenService, safeToClean = false, serial = 0;
const name = prefix => `${prefix}_${process.pid}_${++serial}_${randomUUID().slice(0, 8)}`;
function envFile() {
  const source = readFileSync('.env.test', 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map(line => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^("|')(.*)\1$/, '$2')]));
}
function normalizedAddress(value) { if (!value) return null; const ip = value.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase(); return ip.startsWith('::ffff:') ? ip.slice(7) : ip; }
function loopback(value) { const ip = normalizedAddress(value); return ip && (net.isIP(ip) === 4 ? ip.startsWith('127.') : ip === '::1'); }
function safeAssert(condition, message) { assert.ok(condition, message); }
async function verifyTarget() {
  if (process.env.DISPOSABLE_INTEGRATION_TARGET === 'true') {
    await verifyDisposableIntegrationTarget();
    const declared = Object.fromEntries(['JWT_SECRET','CLIENT_URL','JWT_SECRET_KID','JWT_PREVIOUS_SECRETS','JWT_EXPIRES_IN']
      .filter((key) => process.env[key] !== undefined).map((key) => [key,process.env[key]]));
    return { url: process.env.DATABASE_URL, declared };
  }
  const declared = envFile(), effective = process.env.DATABASE_URL;
  safeAssert(declared.DATABASE_URL && effective === declared.DATABASE_URL, 'effective DATABASE_URL must exactly match .env.test');
  for (const key of ['JWT_SECRET', 'CLIENT_URL']) safeAssert(declared[key] && process.env[key] === declared[key], `effective ${key} must be explicitly supplied by .env.test`);
  for (const key of ['JWT_SECRET_KID', 'JWT_PREVIOUS_SECRETS', 'JWT_EXPIRES_IN']) if (declared[key] !== undefined) safeAssert(process.env[key] === declared[key], `effective ${key} must match .env.test`);
  const url = new URL(declared.DATABASE_URL), database = decodeURIComponent(url.pathname.slice(1));
  safeAssert(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname.toLowerCase() === 'localhost' && url.port === '5432' && database === 'saludback_test' && url.username && url.password && !url.search && !url.hash, 'database target must be exactly localhost:5432/saludback_test with no URL options');
  safeAssert(!/production/i.test(process.env.NODE_ENV ?? ''), 'production mode is forbidden');
  const dnsRows = await dns.lookup(url.hostname, { all: true });
  safeAssert(dnsRows.length > 0 && dnsRows.every(row => loopback(row.address)), 'configured DNS must resolve only to loopback');
  const client = new pg.Client({ connectionString: declared.DATABASE_URL, connectionTimeoutMillis: TIMEOUT, statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 1000, options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000' });
  try {
    await client.connect(); await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`SELECT current_database() db,current_user usr,inet_server_addr()::text server,inet_server_port() port,inet_client_addr()::text peer,current_setting('transaction_read_only') ro`);
    const identity = rows[0];
    safeAssert(rows.length === 1 && identity.db === database && identity.usr === decodeURIComponent(url.username) && Number(identity.port) === 5432 && identity.ro === 'on', 'connected database identity or read-only state mismatch');
    safeAssert(dnsRows.some(row => normalizedAddress(row.address) === normalizedAddress(identity.server)), 'database server must match configured loopback DNS');
    for (const ip of [identity.server, identity.peer, client.connection.stream.remoteAddress, client.connection.stream.localAddress]) safeAssert(loopback(ip), 'database socket endpoints must be loopback');
    safeAssert(normalizedAddress(client.connection.stream.remoteAddress) === normalizedAddress(identity.server), 'database socket server identity mismatch');
    await client.query('ROLLBACK');
    const { rows: ledger } = await client.query('SELECT name FROM public.schema_migrations ORDER BY name');
    assert.deepEqual(ledger.map(row => row.name), MIGRATIONS, 'exact migration ledger 001–035 required before fixture cleanup');
    const { rows: counts } = await client.query('SELECT (SELECT count(*)::int FROM kinesiology_evolutions) evolutions,(SELECT count(*)::int FROM patient_context_availabilities) availabilities,(SELECT count(*)::int FROM patient_assignments) assignments,(SELECT count(*)::int FROM patients) patients,(SELECT count(*)::int FROM users) users');
    assert.deepEqual(counts[0], { evolutions: 0, availabilities: 0, assignments: 0, patients: 0, users: 0 }, 'fixture baseline must be empty before cleanup');
  } catch { throw new Error('Read-only disposable database preflight failed; details intentionally sanitized'); }
  finally { await client.end(); }
  return { url: declared.DATABASE_URL, declared };
}
async function user(role) {
  const username = name(role);
  const { rows } = await pool.query('INSERT INTO users(username,password_hash,role) VALUES ($1,$2,$3) RETURNING id,username,role', [username, 'unused-hash', role]);
  return rows[0];
}
async function ctx(admin, teacher, student, label = 'main') {
  const { rows: subjects } = await pool.query('INSERT INTO subjects(name) VALUES ($1) RETURNING id', [name(`Subject${label}`)]);
  const { rows: groups } = await pool.query('INSERT INTO academic_groups(academic_year,curriculum_semester,name) VALUES (2098,1,$1) RETURNING id', [name(`Group${label}`)]);
  const subject = subjects[0].id, group = groups[0].id;
  await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id) VALUES ($1,$2)', [subject, group]);
  let { rows: tr } = await pool.query('SELECT id FROM teachers WHERE user_id=$1', [teacher.id]);
  if (!tr.length) tr = (await pool.query('INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,$2,$3) RETURNING id', [teacher.id, 'Teacher', 'Fixture'])).rows;
  await pool.query('INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp())', [tr[0].id, subject, group, admin.id]);
  let { rows: studentRows } = await pool.query('SELECT id FROM students WHERE user_id=$1', [student.id]);
  if (!studentRows.length) studentRows = (await pool.query('INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,$2,$3,$4) RETURNING id', [student.id, 'Student', label, name('STU').replaceAll('_', '')])).rows;
  const { rows: periods } = await pool.query('INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id', [studentRows[0].id, subject, group, admin.id]);
  return { subject, group, period: periods[0].id };
}
async function fixture() {
  const admin = await user('admin'), teacher = await user('teacher'), student = await user('estudiante');
  const context = await ctx(admin, teacher, student);
  const patient = async (documento, nombres, apellidos) => (await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion) VALUES ($1,$2,$3,'2000-01-01',$4,'00000000','F','fixture') RETURNING id`, [documento, nombres, apellidos, `${name('patient')}@example.test`])).rows[0].id;
  const documento = `00-12.${serial}`;
  const patientId = await patient(documento, 'Availability', 'Fixture');
  const otherPatient = await patient(`90-${serial}`, 'Unrelated', 'Fixture');
  return { admin, teacher, student, context, patient: patientId, otherPatient, documento };
}
async function token(actor, claims = {}) { return new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid, previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn }).sign({ role: actor.role, sub: actor.id, username: actor.username, ...claims }); }
async function request(method, path, bearer, body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(9000) });
  const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : undefined, cache: response.headers.get('cache-control') };
}
const availBody = (f, context = f.context, patient = f.patient) => ({ patient_id: patient, subject_id: context.subject, academic_group_id: context.group });
async function history(f, adminToken) { return request('GET', `/patient-availabilities/manage?patient_id=${f.patient}`, adminToken); }
async function enable(f, adminToken, context = f.context, patient = f.patient) { return request('POST', '/patient-availabilities', adminToken, availBody(f, context, patient)); }

before(async () => {
  const { url, declared } = await verifyTarget();
  for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('PG') || key.toUpperCase() === 'NODE_PG_FORCE_NATIVE' || ['JWT_SECRET','CLIENT_URL','JWT_SECRET_KID','JWT_PREVIOUS_SECRETS','JWT_EXPIRES_IN'].includes(key)) delete process.env[key];
  process.env.DATABASE_URL = url;
  for (const key of ['JWT_SECRET', 'CLIENT_URL', 'JWT_SECRET_KID', 'JWT_PREVIOUS_SECRETS', 'JWT_EXPIRES_IN']) if (declared[key] !== undefined) process.env[key] = declared[key];
  process.env.PORT = '0';
  const options = '-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000'; process.env.PGOPTIONS = options;
  ({ default: config } = await import('../../src/config.ts'));
  ({ cleanDb } = await import('./helpers/clean-db.js'));
  ({ JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
  const { createApp } = await import('../../src/app.ts');
  pool = new pg.Pool({ connectionString: url, application_name: APP_NAME, max: 8, connectionTimeoutMillis: TIMEOUT, statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 1000, lock_timeout: TIMEOUT, idle_in_transaction_session_timeout: TIMEOUT, options });
  assert.equal(config.databaseUrl, url); const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name'); assert.deepEqual(rows.map(row => row.name), MIGRATIONS);
  safeToClean = true; await cleanDb(pool);
  const app = createApp(pool); server = app.listen(0, '127.0.0.1'); await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); }); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name'); assert.deepEqual(rows.map(row => row.name), MIGRATIONS); await cleanDb(pool); });
after(async () => {
  const errors = [];
  if (pool && safeToClean) try { await cleanDb(pool); const { rows } = await pool.query('SELECT (SELECT count(*)::int FROM kinesiology_evolutions) evolutions,(SELECT count(*)::int FROM patient_context_availabilities) availabilities,(SELECT count(*)::int FROM patient_assignments) assignments,(SELECT count(*)::int FROM patients) patients,(SELECT count(*)::int FROM users) users'); assert.deepEqual(rows[0], { evolutions: 0, availabilities: 0, assignments: 0, patients: 0, users: 0 }); } catch { errors.push(new Error('fixture cleanup or empty-state assertion failed')); }
  if (server) try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch { errors.push(new Error('test server shutdown failed')); }
  if (pool) try { await pool.end(); } catch { errors.push(new Error('pool shutdown failed')); }
  if (errors.length) throw new AggregateError(errors, 'Patient availability integration cleanup failed');
});

test('availability API audits duplicate enable, idempotent withdrawal, re-enable history, and preserves assigned rows', async () => {
  const f = await fixture(), at = await token(f.admin), tt = await token(f.teacher), otherAdmin = await user('admin');
  const first = await enable(f, at); assert.equal(first.status, 201); assert.equal(first.body.enabled_by, f.admin.id);
  const duplicate = await enable(f, at); assert.equal(duplicate.status, 409);
  const before = await history(f, at); assert.equal(before.status, 200); assert.equal(before.cache, 'no-store'); assert.equal(before.body.items.length, 1);
  const assigned = await request('POST', '/patient-assignments', tt, { ...availBody(f), student_habilitation_id: f.context.period }); assert.equal(assigned.status, 201);
  const withdrawn = await request('POST', `/patient-availabilities/${first.body.id}/withdraw`, at, {}); assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.withdrawn_by, f.admin.id);
  const repeated = await request('POST', `/patient-availabilities/${first.body.id}/withdraw`, await token(otherAdmin), {}); assert.equal(repeated.status, 200); assert.deepEqual(repeated.body, withdrawn.body);
  assert.equal((await request('POST', '/patient-assignments', tt, { ...availBody(f), student_habilitation_id: f.context.period })).status, 409);
  assert.equal((await request('GET', '/patient-assignments', tt)).body.items.length, 1);
  assert.equal((await request('POST', `/patient-assignments/${assigned.body.id}/end`, tt, { end_reason: 'explicit end' })).status, 200);
  const second = await enable(f, at); assert.equal(second.status, 201); assert.notEqual(second.body.id, first.body.id);
  const final = await history(f, at); assert.equal(final.body.items.length, 2); assert.equal(final.body.items.filter(row => row.withdrawn_at === null).length, 1); assert.equal(final.body.items.find(row => row.id === first.body.id).withdrawn_by, f.admin.id);
});

test('teacher selectors reveal only active availability and live exact context; selectors scope contexts and students', async () => {
  const f = await fixture(), at = await token(f.admin), tt = await token(f.teacher);
  const other = await ctx(f.admin, f.teacher, f.student, 'other');
  const unrelatedTeacher = await user('teacher'), foreignContext = await ctx(f.admin, unrelatedTeacher, f.student, 'foreign');
  await enable(f, at); await enable(f, at, other, f.otherPatient); await enable(f, at, foreignContext, f.otherPatient);
  const options = await request('GET', '/patient-assignment-options/contexts?limit=1&offset=0', tt); assert.equal(options.status, 200); assert.equal(options.cache, 'no-store'); assert.equal(options.body.items.length, 1); assert.equal(options.body.limit, 1);
  const contexts = await request('GET', '/patient-assignment-options/contexts', tt); assert.equal(contexts.body.items.length, 2);
  const students = await request('GET', `/patient-assignment-options/students?subject_id=${f.context.subject}&academic_group_id=${f.context.group}`, tt); assert.equal(students.status, 200); assert.equal(students.body.items.length, 1); assert.deepEqual(Object.keys(students.body.items[0]).sort(), ['student_habilitation_id','student_id','nombres','apellidos'].sort());
  assert.equal((await request('GET', `/patient-assignment-options/students?subject_id=${other.subject}&academic_group_id=${other.group}`, tt)).body.items.length, 1);
  await pool.query('UPDATE student_academic_habilitations SET revoked_by=$1,revoked_at=clock_timestamp() WHERE id=$2', [f.admin.id, f.context.period]);
  assert.equal((await request('GET', `/patient-assignment-options/students?subject_id=${f.context.subject}&academic_group_id=${f.context.group}`, tt)).body.items.length, 0);
  const patientRows = await request('GET', `/patient-availabilities?subject_id=${f.context.subject}&academic_group_id=${f.context.group}`, tt); assert.equal(patientRows.status, 200); assert.equal(patientRows.cache, 'no-store'); assert.deepEqual(patientRows.body.items.map(row => row.patient_id), [f.patient]); assert.deepEqual(Object.keys(patientRows.body.items[0]).sort(), ['patient_id','nombres','apellidos'].sort());
  const otherContextRows = await request('GET', `/patient-availabilities?subject_id=${other.subject}&academic_group_id=${other.group}`, tt);
  assert.deepEqual(otherContextRows.body.items.map(item => item.patient_id), [f.otherPatient]);
  const otherAvailability = await pool.query('SELECT id FROM patient_context_availabilities WHERE patient_id=$1 AND subject_id=$2 AND academic_group_id=$3 AND withdrawn_at IS NULL', [f.otherPatient, other.subject, other.group]);
  assert.equal(otherAvailability.rows.length, 1);
  assert.equal((await request('POST', `/patient-availabilities/${otherAvailability.rows[0].id}/withdraw`, at, {})).status, 200);
  assert.equal((await request('GET', `/patient-availabilities?subject_id=${other.subject}&academic_group_id=${other.group}`, tt)).body.items.length, 0);
  assert.equal((await request('GET', `/patient-availabilities?subject_id=${foreignContext.subject}&academic_group_id=${foreignContext.group}`, tt)).body.items.length, 0);
  await pool.query('UPDATE teacher_academic_habilitations SET revoked_by=$1,revoked_at=clock_timestamp() WHERE teacher_id=(SELECT id FROM teachers WHERE user_id=$2) AND subject_id=$3', [f.admin.id, f.teacher.id, f.context.subject]);
  assert.equal((await request('GET', `/patient-availabilities?subject_id=${f.context.subject}&academic_group_id=${f.context.group}`, tt)).body.items.length, 0);
  assert.equal((await request('GET', '/patient-assignment-options/contexts', tt)).body.items.length, 1);
});

test('document lookup is exact trimmed admin-only with minimal fields; fresh permission revocation beats unchanged token claims', async () => {
  const f = await fixture(), at = await token(f.admin), tt = await token(f.teacher), st = await token(f.student);
  const search = await request('POST', '/patient-availabilities/patient-search', at, { documento: `  ${f.documento}  ` }); assert.equal(search.status, 200); assert.equal(search.cache, 'no-store'); assert.deepEqual(Object.keys(search.body.items[0]).sort(), ['patient_id','nombres','apellidos'].sort()); assert.equal(search.body.items[0].patient_id, f.patient);
  assert.deepEqual((await request('POST', '/patient-availabilities/patient-search', at, { documento: `x${f.documento}` })).body.items, []);
  assert.deepEqual((await request('POST', '/patient-availabilities/patient-search', at, { documento: 'missing' })).body.items, []);
  const forged = await token(f.teacher, { permissions: ['patient-availabilities:manage'] });
  for (const bearer of [tt, st, forged]) { assert.equal((await request('POST', '/patient-availabilities', bearer, availBody(f))).status, 403); assert.equal((await request('POST', '/patient-availabilities/patient-search', bearer, { documento: `00-12.${serial}` })).status, 403); }
  const adminAvailability = await enable(f, at); assert.equal(adminAvailability.status, 201);
  await pool.query("DELETE FROM role_permissions WHERE role='admin' AND permission='patient-availabilities:manage'");
  const denied = await request('POST', `/patient-availabilities/${adminAvailability.body.id}/withdraw`, at, {}); assert.equal(denied.status, 403);
  assert.equal((await pool.query('SELECT withdrawn_at FROM patient_context_availabilities WHERE id=$1', [adminAvailability.body.id])).rows[0].withdrawn_at, null);
  await pool.query("INSERT INTO role_permissions(role,permission) VALUES ('admin','patient-availabilities:manage')");
  assert.equal((await request('POST', `/patient-availabilities/${adminAvailability.body.id}/withdraw`, at, {})).status, 200);
  assert.equal((await request('GET', `/patient-availabilities?subject_id=${f.context.subject}&academic_group_id=${f.context.group}`, at)).status, 403, 'admin role has no implicit teacher selector access');
});

test('public routes validate UUID/pagination and preserve response privacy', async () => {
  const f = await fixture(), at = await token(f.admin), tt = await token(f.teacher); await enable(f, at);
  assert.equal((await request('GET', '/patient-availabilities?subject_id=no&academic_group_id=bad', tt)).status, 400);
  assert.equal((await request('GET', `/patient-availabilities?subject_id=${f.context.subject}&academic_group_id=${f.context.group}&limit=101`, tt)).status, 400);
  assert.equal((await request('GET', `/patient-assignment-options/students?subject_id=${f.context.subject}&academic_group_id=${f.context.group}&offset=10001`, tt)).status, 400);
  assert.equal((await request('GET', '/patient-availabilities/manage?patient_id=bad', at)).status, 400);
  const search = await request('POST', '/patient-availabilities/patient-search', at, { documento: f.documento });
  assert.equal(search.body.items[0].email, undefined); assert.equal(search.body.items[0].documento, undefined); assert.equal(search.body.items[0].direccion, undefined);
});

test('PostgreSQL availability constraints reject duplicates, unpaired or reversed audit facts and invalid foreign keys', async () => {
  const f = await fixture(), at = await token(f.admin), row = await enable(f, at); assert.equal(row.status, 201);
  const baseline = async () => (await pool.query("SELECT count(*)::int total,count(*) FILTER (WHERE withdrawn_at IS NULL)::int active,(SELECT jsonb_build_object('id',id,'enabled_by',enabled_by,'enabled_at',enabled_at,'withdrawn_by',withdrawn_by,'withdrawn_at',withdrawn_at) FROM patient_context_availabilities WHERE id=$1) audit FROM patient_context_availabilities", [row.body.id])).rows[0];
  const before = await baseline();
  await assert.rejects(pool.query('INSERT INTO patient_context_availabilities(patient_id,subject_id,academic_group_id,enabled_by) VALUES ($1,$2,$3,$4)', [f.patient, f.context.subject, f.context.group, f.admin.id]), { code: '23505' });
  await assert.rejects(pool.query('UPDATE patient_context_availabilities SET withdrawn_by=$1 WHERE id=$2', [f.admin.id, row.body.id]), { code: '23514' });
  await assert.rejects(pool.query('UPDATE patient_context_availabilities SET withdrawn_by=$1,withdrawn_at=enabled_at-interval \'1 second\' WHERE id=$2', [f.admin.id, row.body.id]), { code: '23514' });
  const absent = randomUUID();
  for (const args of [[absent,f.context.subject,f.context.group,f.admin.id],[f.patient,absent,f.context.group,f.admin.id],[f.patient,f.context.subject,absent,f.admin.id],[f.otherPatient,f.context.subject,f.context.group,absent]]) await assert.rejects(pool.query('INSERT INTO patient_context_availabilities(patient_id,subject_id,academic_group_id,enabled_by) VALUES ($1,$2,$3,$4)', args), { code: '23503' });
  assert.deepEqual(await baseline(), before);
  await assert.rejects(pool.query('DELETE FROM patients WHERE id=$1', [f.patient]), { code: '23503' });
  await assert.rejects(pool.query('DELETE FROM users WHERE id=$1', [f.admin.id]), { code: '23503' });
  assert.deepEqual(await baseline(), before);
});

test('availability audit actor and patient foreign keys restrict deletion without changing retained history', async () => {
  const f = await fixture(), enabler = await user('admin'), withdrawer = await user('admin');
  const enabled = await enable(f, await token(enabler)); assert.equal(enabled.status, 201); assert.equal(enabled.body.enabled_by, enabler.id);
  const withdrawn = await request('POST', `/patient-availabilities/${enabled.body.id}/withdraw`, await token(withdrawer), {});
  assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.withdrawn_by, withdrawer.id);
  const snapshot = await history(f, await token(f.admin)); assert.equal(snapshot.body.items.length, 1);
  await assert.rejects(pool.query('DELETE FROM users WHERE id=$1', [enabler.id]), { code: '23503' });
  await assert.rejects(pool.query('DELETE FROM users WHERE id=$1', [withdrawer.id]), { code: '23503' });
  await assert.rejects(pool.query('DELETE FROM patients WHERE id=$1', [f.patient]), { code: '23503' });
  const retained = await history(f, await token(f.admin)); assert.deepEqual(retained.body, snapshot.body);
  assert.equal((await pool.query('SELECT enabled_by,withdrawn_by FROM patient_context_availabilities WHERE id=$1', [enabled.body.id])).rows[0].enabled_by, enabler.id);
});
