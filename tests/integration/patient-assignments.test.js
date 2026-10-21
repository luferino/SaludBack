import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';

const TIMEOUT = 5000;
const APP_NAME = 'patient-assignments-integration';
const EXPECTED_MIGRATIONS = Array.from({ length: 19 }, (_, i) => `${String(i + 1).padStart(3, '0')}_${[
  'create_users.sql', 'create_patients.sql', 'add_email_and_reset_tokens.sql', 'multi_role_and_audit.sql',
  'user_id_unique_profiles.sql', 'create_permission_matrix.sql', 'seed_permission_matrix.sql',
  'create_clinical_records.sql', 'create_academic_contexts.sql', 'create_academic_habilitations.sql',
  'seed_subject_permissions.sql', 'seed_group_permissions.sql', 'seed_subject_group_permissions.sql',
  'seed_teacher_habilitation_permissions.sql', 'seed_teacher_habilitation_revocation_permission.sql',
  'seed_student_habilitation_permissions.sql', 'create_patient_assignments.sql',
  'seed_patient_assignment_permissions.sql', 'seed_student_habilitation_revocation_permission.sql',
][i]}`);
let pool;
let server;
let baseUrl;
let config;
let cleanDb;
let JwtTokenService;
let safeToClean = false;
let seq = 0;

function testUrl() {
  const raw = readFileSync('.env.test', 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)?.[1];
  assert.ok(raw, '.env.test must define DATABASE_URL');
  return raw.replace(/^("|')(.*)\1$/, '$2');
}
function address(value) {
  if (!value) return null;
  const normalized = value.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase();
  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
}
function loopback(value) {
  const ip = address(value);
  return ip && (net.isIP(ip) === 4 ? ip.startsWith('127.') : ip === '::1');
}
async function verifyTarget() {
  const fileUrl = testUrl();
  assert.ok(process.env.DATABASE_URL === fileUrl, 'effective DATABASE_URL must match .env.test');
  const url = new URL(fileUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(url.hostname && url.port && url.username && url.password && !url.search && !url.hash);
  const database = decodeURIComponent(url.pathname.slice(1));
  assert.match(database, /(?:^|[_-])test(?:ing)?(?:$|[_-])/i, 'target name must identify a test database');
  assert.doesNotMatch(database, /prod|develop/i);
  assert.doesNotMatch(process.env.NODE_ENV ?? '', /production/i);
  const dnsResult = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  assert.ok(dnsResult.length && dnsResult.every(({ address: ip }) => loopback(ip)), 'configured DNS must be loopback only');
  const client = new pg.Client({ connectionString: fileUrl, connectionTimeoutMillis: TIMEOUT,
    statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 1000,
    options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`SELECT current_database() db, current_user usr,
      inet_server_addr()::text server, inet_server_port() port, inet_client_addr()::text peer,
      current_setting('transaction_read_only') read_only`);
    assert.equal(rows.length, 1);
    const identity = rows[0];
    assert.equal(identity.db, database);
    assert.equal(identity.usr, decodeURIComponent(url.username));
    assert.equal(Number(identity.port), Number(url.port));
    assert.equal(identity.read_only, 'on');
    assert.ok(dnsResult.some(({ address: ip }) => address(ip) === address(identity.server)), 'server must match resolved peer');
    const socket = client.connection.stream;
    for (const ip of [identity.server, identity.peer, socket.remoteAddress, socket.localAddress]) {
      assert.ok(loopback(ip), 'database and socket peers must all be loopback');
    }
    assert.equal(address(socket.remoteAddress), address(identity.server));
    await client.query('ROLLBACK');
    const { rows: ledger } = await client.query('SELECT name FROM public.schema_migrations ORDER BY name');
    assert.deepEqual(ledger.map(row => row.name), EXPECTED_MIGRATIONS,
      'the exact expected migration ledger 001-019 is required before fixture cleanup');
    const { rows: counts } = await client.query(`SELECT
      (SELECT count(*)::int FROM patient_assignments) assignments,
      (SELECT count(*)::int FROM student_academic_habilitations) student_periods,
      (SELECT count(*)::int FROM teacher_academic_habilitations) teacher_periods,
      (SELECT count(*)::int FROM patients) patients,
      (SELECT count(*)::int FROM users) users`);
    assert.ok(counts.length === 1, 'safe fixture counts unavailable');
    console.log(`Disposable DB preflight passed: ${identity.db}:${identity.port}, loopback, read-only; ledger=${ledger.length}; fixture counts assignments=${counts[0].assignments}, studentPeriods=${counts[0].student_periods}, teacherPeriods=${counts[0].teacher_periods}, patients=${counts[0].patients}, users=${counts[0].users}`);
  } finally {
    await client.end();
  }
  return fileUrl;
}
function name(prefix) { seq += 1; return `${prefix}_${process.pid}_${seq}_${randomUUID().slice(0, 7)}`; }
async function user(role) {
  const username = name(role);
  const { rows } = await pool.query('INSERT INTO users (username,password_hash,role) VALUES ($1,$2,$3) RETURNING id', [username, 'unused-hash', role]);
  return { id: rows[0].id, username, role };
}
async function context() {
  const n = name('fixture');
  const { rows: s } = await pool.query('INSERT INTO subjects(name) VALUES ($1) RETURNING id', [`${n}_subject`]);
  const { rows: g } = await pool.query('INSERT INTO academic_groups(academic_year,curriculum_semester,name) VALUES (2098,1,$1) RETURNING id', [`${n}_group`]);
  await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id) VALUES ($1,$2)', [s[0].id,g[0].id]);
  return { subjectId:s[0].id, groupId:g[0].id };
}
async function fixture() {
  const admin = await user('admin');
  const teacher = await user('teacher');
  const { rows: teacherRows } = await pool.query('INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,$2,$3) RETURNING id', [teacher.id,'Teacher','Fixture']);
  const ctx = await context();
  await pool.query(`INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp())`, [teacherRows[0].id,ctx.subjectId,ctx.groupId,admin.id]);
  const student = await user('estudiante');
  const codalumno = `STU${process.pid}${seq}${randomUUID().replaceAll('-', '')}`;
  const { rows: studentRows } = await pool.query('INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,$2,$3,$4) RETURNING id', [student.id,'Student','Fixture',codalumno]);
  const { rows: patientRows } = await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion)
    VALUES ($1,$2,$3,'2000-01-01',$4,'00000000','F','Fixture') RETURNING id`, [String(10000000 + seq),name('Patient'), 'Assignment', `${name('patient')}@example.test`]);
  const { rows: periodRows } = await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id`, [studentRows[0].id,ctx.subjectId,ctx.groupId,admin.id]);
  return { admin, teacher, student, patient: patientRows[0].id, period: periodRows[0].id, ctx };
}
async function token(userInfo) {
  return new JwtTokenService({ secret:config.jwtSecret, secretKid:config.jwtSecretKid,
    previousSecrets:config.jwtPreviousSecrets, expiresIn:config.jwtExpiresIn })
    .sign({ role:userInfo.role, sub:userInfo.id, username:userInfo.username });
}
async function request(method,path,tokenValue,body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers:{ ...(tokenValue ? { authorization:`Bearer ${tokenValue}` } : {}), ...(body ? {'content-type':'application/json'}:{}) },
    ...(body ? {body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(9000) });
  const text = await response.text();
  return { status:response.status, body:text ? JSON.parse(text) : undefined };
}
function payload(f) { return { patient_id:f.patient, student_habilitation_id:f.period, subject_id:f.ctx.subjectId, academic_group_id:f.ctx.groupId }; }
async function rows() { return (await pool.query('SELECT id::text id,patient_id,student_habilitation_id,subject_id,assigned_by FROM patient_assignments ORDER BY id')).rows; }

before(async () => {
  const databaseUrl = await verifyTarget();
  for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('PG') || key.toUpperCase()==='NODE_PG_FORCE_NATIVE') delete process.env[key];
  const pgOptions = '-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000';
  process.env.DATABASE_URL = databaseUrl;
  process.env.PGOPTIONS = pgOptions;
  process.env.JWT_PREVIOUS_SECRETS ??= '[]';
  process.env.PORT = '0';
  ({ default:config } = await import('../../src/config.ts'));
  ({ cleanDb } = await import('./helpers/clean-db.js'));
  ({ JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
  const { createApp } = await import('../../src/app.ts');
  pool = new pg.Pool({ connectionString:databaseUrl, application_name:APP_NAME, max:12,
    connectionTimeoutMillis:TIMEOUT, statement_timeout:TIMEOUT, query_timeout:TIMEOUT+1000,
    lock_timeout:TIMEOUT, idle_in_transaction_session_timeout:TIMEOUT, options:pgOptions });
  const app = createApp(pool);
  server = app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{ server.once('listening',resolve); server.once('error',reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const { rows: ledger } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  assert.deepEqual(ledger.map(row => row.name), EXPECTED_MIGRATIONS, 'all expected migrations are required before cleanup');
  safeToClean = true;
});
beforeEach(async () => {
  const { rows:ledger } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  assert.deepEqual(ledger.map(row=>row.name),EXPECTED_MIGRATIONS,'017/018 must be applied before any fixture cleanup');
  await cleanDb(pool);
});
after(async () => {
  const errors=[];
  if(pool && safeToClean) {
    try { await cleanDb(pool); } catch(error) { errors.push(error); }
    try { const {rows:counts}=await pool.query(`SELECT (SELECT count(*)::int FROM patient_assignments) assignments,
      (SELECT count(*)::int FROM student_academic_habilitations) student_periods,(SELECT count(*)::int FROM teacher_academic_habilitations) teacher_periods,
      (SELECT count(*)::int FROM patients) patients,(SELECT count(*)::int FROM users) users`);
      console.log(`Fixture cleanup counts: assignments=${counts[0].assignments}, studentPeriods=${counts[0].student_periods}, teacherPeriods=${counts[0].teacher_periods}, patients=${counts[0].patients}, users=${counts[0].users}`);
      assert.deepEqual(counts[0],{assignments:0,student_periods:0,teacher_periods:0,patients:0,users:0});
    } catch(error) { errors.push(error); }
  }
  if(server) try { await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())); } catch(error) { errors.push(error); }
  if(pool) try { await pool.end(); } catch(error) { errors.push(error); }
  if(errors.length) throw new AggregateError(errors,'Patient assignment integration cleanup failed');
});

test('public create returns exact assignment JSON, token actor, and lossless BIGINT string without clinical/contact fields', async()=>{
  const f=await fixture();
  const {rows:sequence}=await pool.query("SELECT pg_get_serial_sequence('patient_assignments','id') sequence");
  await pool.query('SELECT setval($1, 9007199254740992, true)',[sequence[0].sequence]);
  const created=await request('POST','/patient-assignments',await token(f.teacher),payload(f));
  assert.equal(created.status,201);
  assert.deepEqual(Object.keys(created.body).sort(),['academic_group_id','assigned_at','assigned_by','ended_at','ended_by','id','patient_id','student_habilitation_id','subject_id','end_reason'].sort());
  assert.equal(created.body.id,'9007199254740993');
  assert.equal(created.body.assigned_by,f.teacher.id);
  assert.equal(created.body.academic_group_id,f.ctx.groupId);
  assert.equal(created.body.patient_id,f.patient);
  assert.equal(created.body.student_habilitation_id,f.period);
  assert.equal(created.body.email,undefined); assert.equal(created.body.celular,undefined); assert.equal(created.body.direccion,undefined);
  const stored=await rows(); assert.equal(stored.length,1); assert.equal(stored[0].assigned_by,f.teacher.id);
  await assert.rejects(pool.query('DELETE FROM patients WHERE id=$1',[f.patient]),{code:'23503'});
  await assert.rejects(pool.query('DELETE FROM student_academic_habilitations WHERE id=$1',[f.period]),{code:'23503'});
  await assert.rejects(pool.query('DELETE FROM users WHERE id=$1',[f.teacher.id]),{code:'23503'});
});

test('invalid, unauthorized, missing patient, and mismatched period requests preserve assignment state; FK and unique constraints are real',async()=>{
  const f=await fixture(); const body=payload(f); const t=await token(f.teacher);
  const before=await pool.query('SELECT count(*)::int n FROM users');
  assert.equal((await request('POST','/patient-assignments',null,body)).status,401);
  assert.equal((await request('POST','/patient-assignments',t,{...body,patient_id:'not-a-uuid'})).status,400);
  const noContext={...body,academic_group_id:(await context()).groupId};
  assert.equal((await request('POST','/patient-assignments',t,noContext)).status,403);
  assert.equal((await request('POST','/patient-assignments',t,{...body,patient_id:'00000000-0000-0000-0000-000000000000'})).status,404);
  const other=await fixture();
  assert.equal((await request('POST','/patient-assignments',t,{...body,student_habilitation_id:other.period})).status,404);
  assert.equal((await rows()).length,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n,before.rows[0].n+3);
  await assert.rejects(pool.query(`INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by)
    VALUES ($1,$2,$3,$4)`,[f.patient,f.period,other.ctx.subjectId,f.teacher.id]),{code:'23503'});
});

test('simultaneous same-patient/subject creates across different groups commit exactly one active row and a conflict',async()=>{
  const f=await fixture(); const t=await token(f.teacher); const body=payload(f);
  const {rows:groupRows}=await pool.query(`INSERT INTO academic_groups(academic_year,curriculum_semester,name)
    VALUES (2098,1,$1) RETURNING id`,[name('other_group')]);
  const groupId=groupRows[0].id;
  await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id) VALUES ($1,$2)',[f.ctx.subjectId,groupId]);
  await pool.query(`INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at)
    SELECT id,$1,$2,$3,clock_timestamp() FROM teachers WHERE user_id=$4`,[f.ctx.subjectId,groupId,f.admin.id,f.teacher.id]);
  const {rows:periodRows}=await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    SELECT id,$1,$2,$3,clock_timestamp() FROM students WHERE user_id=$4 RETURNING id`,[f.ctx.subjectId,groupId,f.admin.id,f.student.id]);
  const otherGroupBody={...body,academic_group_id:groupId,student_habilitation_id:periodRows[0].id};
  const result=await Promise.all([request('POST','/patient-assignments',t,body),request('POST','/patient-assignments',t,otherGroupBody)]);
  assert.deepEqual(result.map(r=>r.status).sort((a,b)=>a-b),[201,409]);
  assert.equal((await rows()).length,1);
});

async function waitForPatientLock() {
  const deadline=Date.now()+4000;
  while(Date.now()<deadline) {
    const {rows:blocked}=await pool.query(`SELECT pid FROM pg_catalog.pg_stat_activity
      WHERE datname=current_database() AND application_name=$1 AND state='active'
        AND wait_event_type='Lock' AND query ILIKE $2 LIMIT 1`,[APP_NAME,'%FROM patients%FOR UPDATE%']);
    if(blocked.length) return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.fail('timed out observing assignment blocked on patient row lock');
}

test('creation waits on a real patient row lock before committing',async()=>{
  const f=await fixture();
  const blocker=new pg.Client({connectionString:config.databaseUrl,connectionTimeoutMillis:TIMEOUT,
    statement_timeout:TIMEOUT,query_timeout:TIMEOUT+1000,lock_timeout:TIMEOUT,
    application_name:`${APP_NAME}-blocker`,options:'-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000'});
  await blocker.connect();
  let transaction=false;
  try {
    await blocker.query('BEGIN'); transaction=true;
    await blocker.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE',[f.patient]);
    const pending=request('POST','/patient-assignments',await token(f.teacher),payload(f));
    await waitForPatientLock();
    await blocker.query('COMMIT'); transaction=false;
    const created=await pending;
    assert.equal(created.status,201);
    assert.equal((await rows()).length,1);
  } finally {
    if(transaction) await blocker.query('ROLLBACK').catch(()=>{});
    await blocker.end();
  }
});

test('teacher context and student own lists use active context and active period/assignment predicates with fresh grants',async()=>{
  const f=await fixture(); const t=await token(f.teacher); const s=await token(f.student);
  assert.equal((await request('GET','/patient-assignments',t)).status,200);
  const created=await request('POST','/patient-assignments',t,payload(f)); assert.equal(created.status,201);
  const teacherList=await request('GET','/patient-assignments',t); assert.equal(teacherList.body.items.length,1);
  const own=await request('GET','/patient-assignments/mine',s); assert.equal(own.body.items.length,1);
  await pool.query("DELETE FROM role_permissions WHERE role='teacher' AND permission='patient-assignments:read'");
  assert.equal((await request('GET','/patient-assignments',t)).status,403);
  await pool.query("INSERT INTO role_permissions(role,permission) VALUES ('teacher','patient-assignments:read')");
  await pool.query('UPDATE patient_assignments SET ended_by=$1,ended_at=clock_timestamp() WHERE patient_id=$2',[f.admin.id,f.patient]);
  assert.equal((await request('GET','/patient-assignments',t)).body.items.length,0);
  assert.equal((await request('GET','/patient-assignments/mine',s)).body.items.length,0);
  await pool.query('UPDATE patient_assignments SET ended_by=NULL,ended_at=NULL WHERE patient_id=$1',[f.patient]);
  await pool.query('UPDATE student_academic_habilitations SET revoked_by=$1,revoked_at=clock_timestamp() WHERE id=$2',[f.admin.id,f.period]);
  assert.equal((await request('GET','/patient-assignments/mine',s)).body.items.length,0);
  const adminToken=await token(f.admin);
  assert.equal((await request('GET','/patient-assignments',adminToken)).status,403);
  assert.equal((await request('GET','/patient-assignments/mine',adminToken)).status,403);
});
