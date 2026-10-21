import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';

const APP_NAME = 'kinesiology-evaluation-drafts-integration';
const TIMEOUT = 5000;
const MIGRATIONS = [
  '001_create_users.sql','002_create_patients.sql','003_add_email_and_reset_tokens.sql','004_multi_role_and_audit.sql',
  '005_user_id_unique_profiles.sql','006_create_permission_matrix.sql','007_seed_permission_matrix.sql','008_create_clinical_records.sql',
  '009_create_academic_contexts.sql','010_create_academic_habilitations.sql','011_seed_subject_permissions.sql','012_seed_group_permissions.sql',
  '013_seed_subject_group_permissions.sql','014_seed_teacher_habilitation_permissions.sql','015_seed_teacher_habilitation_revocation_permission.sql',
  '016_seed_student_habilitation_permissions.sql','017_create_patient_assignments.sql','018_seed_patient_assignment_permissions.sql',
  '019_seed_student_habilitation_revocation_permission.sql','020_create_kinesiology_evaluations.sql','021_seed_kinesiology_evaluation_permissions.sql',
  '022_create_kinesiology_consent_attestations.sql',
];
const EXPECTED_PERMISSIONS = [
  'users:write','students:write','teachers:write','patients:write','profile:read','materias:read','turnos:read',
  'subjects:write','subjects:read','groups:write','groups:read','subject-groups:write','subject-groups:read',
  'teacher-habilitations:write','teacher-habilitations:revoke','student-habilitations:write','student-habilitations:revoke',
  'patient-assignments:write','patient-assignments:read','patient-assignments:read-own',
  'kinesiology-evaluations:read','kinesiology-evaluations:write','kinesiology-evaluations:submit',
  'kinesiology-evaluations:verify-consent','kinesiology-evaluations:review',
];
const EXPECTED_GRANTS = [
  'estudiante:profile:read','estudiante:materias:read','estudiante:turnos:read','teacher:profile:read','teacher:materias:read','teacher:turnos:read',
  'admin:users:write','admin:students:write','admin:teachers:write','admin:patients:write','admin:profile:read','admin:materias:read','admin:turnos:read',
  'admin:subjects:write','admin:subjects:read','admin:groups:write','admin:groups:read','admin:subject-groups:write','admin:subject-groups:read',
  'admin:teacher-habilitations:write','admin:teacher-habilitations:revoke','teacher:student-habilitations:write','teacher:student-habilitations:revoke',
  'teacher:patient-assignments:write','teacher:patient-assignments:read','estudiante:patient-assignments:read-own',
  'teacher:kinesiology-evaluations:read','estudiante:kinesiology-evaluations:read','estudiante:kinesiology-evaluations:write',
  'estudiante:kinesiology-evaluations:submit','teacher:kinesiology-evaluations:verify-consent','teacher:kinesiology-evaluations:review',
];
const CLINICAL_PERMISSIONS = ['kinesiology-evaluations:read','kinesiology-evaluations:write','kinesiology-evaluations:submit','kinesiology-evaluations:verify-consent','kinesiology-evaluations:review'];
const CLINICAL_GRANTS = [
  'estudiante:kinesiology-evaluations:read','estudiante:kinesiology-evaluations:write','estudiante:kinesiology-evaluations:submit',
  'teacher:kinesiology-evaluations:read','teacher:kinesiology-evaluations:verify-consent','teacher:kinesiology-evaluations:review',
];
let pool, server, baseUrl, config, JwtTokenService, cleanDb;
let cleanupAuthorized = false;
let serial = 0;

function safeMessage(error) {
  // Never serialize pg config/error objects: they may contain credentials or a URL.
  return error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s'"),]+/gi, '[database-url]') : 'unknown error';
}
function ip(value) {
  const normalized = value?.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase();
  return normalized?.startsWith('::ffff:') ? normalized.slice(7) : normalized;
}
function loopback(value) {
  const valueIp = ip(value);
  return Boolean(valueIp && (net.isIP(valueIp) === 4 ? valueIp.startsWith('127.') : valueIp === '::1'));
}
function exactTestUrl() {
  const raw = readFileSync('.env.test', 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)?.[1];
  assert.ok(raw, '.env.test must define DATABASE_URL');
  const value = raw.replace(/^("|')(.*)\1$/, '$2');
  assert.equal(typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL === value, true,
    'effective DATABASE_URL must exactly match parsed .env.test DATABASE_URL');
  const url = new URL(value);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol), 'test target must use PostgreSQL');
  assert.equal(url.hostname.toLowerCase(), 'localhost', 'only localhost is an accepted target host');
  assert.equal(url.port, '5432', 'only port 5432 is accepted');
  assert.equal(decodeURIComponent(url.pathname.slice(1)), 'saludback_test', 'only saludback_test is accepted');
  assert.ok(url.username && url.password && !url.search && !url.hash, 'plain URL with credentials and no options is required');
  assert.doesNotMatch(process.env.NODE_ENV ?? '', /production/i);
  assert.doesNotMatch(process.env.APP_ENV ?? '', /production/i);
  return { value, url };
}
async function readonlyPreflight() {
  const { value, url } = exactTestUrl();
  const resolved = await dns.lookup('localhost', { all: true });
  assert.ok(resolved.length && resolved.every(row => loopback(row.address)), 'localhost must resolve only to loopback');
  const client = new pg.Client({ connectionString:value, connectionTimeoutMillis:TIMEOUT, statement_timeout:TIMEOUT,
    query_timeout:TIMEOUT + 1000, options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`SELECT current_database() db,current_user usr,inet_server_addr()::text server,
      inet_server_port() port,inet_client_addr()::text peer,current_setting('transaction_read_only') ro`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].db, 'saludback_test');
    assert.equal(rows[0].usr, decodeURIComponent(url.username));
    assert.equal(Number(rows[0].port), 5432);
    assert.equal(rows[0].ro, 'on');
    assert.ok(resolved.some(row => ip(row.address) === ip(rows[0].server)), 'server address must match localhost resolution');
    for (const peer of [rows[0].server, rows[0].peer, client.connection.stream.remoteAddress, client.connection.stream.localAddress])
      assert.ok(loopback(peer), 'server, client and socket addresses must be loopback');
    assert.equal(ip(client.connection.stream.remoteAddress), ip(rows[0].server));
    await client.query('ROLLBACK');
    const { rows: ledger } = await client.query('SELECT name FROM public.schema_migrations ORDER BY name');
    assert.deepEqual(ledger.map(row => row.name), MIGRATIONS, 'exact migration ledger 001–021 required before cleanup');
    const { rows: permissions } = await client.query('SELECT permission,enforced FROM public.permissions ORDER BY permission');
    assert.equal(permissions.length, 25, 'exact 25-permission canonical baseline required');
    assert.deepEqual(permissions.map(row=>row.permission),[...EXPECTED_PERMISSIONS].sort(),'unknown or missing permissions are unsafe');
    assert.ok(permissions.every(row => row.enforced === true || ['materias:read','turnos:read'].includes(row.permission)));
    assert.deepEqual(permissions.filter(row => CLINICAL_PERMISSIONS.includes(row.permission)), CLINICAL_PERMISSIONS.map(permission => ({ permission, enforced:true })).sort((a,b) => a.permission.localeCompare(b.permission)));
    const { rows: grants } = await client.query('SELECT role,permission FROM public.role_permissions ORDER BY role,permission');
    assert.equal(grants.length, 32, 'exact 32-grant canonical baseline required');
    assert.deepEqual(grants.map(row=>`${row.role}:${row.permission}`),[...EXPECTED_GRANTS].sort(),'unknown or missing grants are unsafe');
    assert.deepEqual(grants.filter(row => row.permission.startsWith('kinesiology-evaluations:')).map(row => `${row.role}:${row.permission}`).sort(), [...CLINICAL_GRANTS].sort());
    assert.deepEqual(grants.filter(row => row.permission.startsWith('patient-assignments:')).map(row => `${row.role}:${row.permission}`).sort(), [
      'estudiante:patient-assignments:read-own','teacher:patient-assignments:read','teacher:patient-assignments:write',
    ]);
    assert.deepEqual(grants.filter(row => row.role === 'admin' && ['teacher-habilitations:write','teacher-habilitations:revoke'].includes(row.permission)).map(row => `${row.role}:${row.permission}`).sort(),
      ['admin:teacher-habilitations:revoke','admin:teacher-habilitations:write']);
    const { rows: baseline } = await client.query(`SELECT (SELECT count(*)::int FROM public.permissions) permissions,
      (SELECT count(*)::int FROM public.role_permissions) grants`);
    assert.deepEqual(baseline[0], { permissions:25, grants:32 });
  } finally { await client.end(); }
  return value;
}
function name(prefix) { serial++; return `${prefix}${process.pid}${serial}${randomUUID().replaceAll('-','').slice(0,8)}`; }
async function fixture() {
  const { rows: users } = await pool.query(`INSERT INTO users(username,password_hash,role) VALUES
    ($1,'unused','admin'),($2,'unused','teacher'),($3,'unused','teacher'),($4,'unused','estudiante'),($5,'unused','estudiante') RETURNING id,username,role`,
  [name('admin'),name('teacher'),name('otherteacher'),name('student'),name('otherstudent')]);
  const [admin, teacher, otherTeacher, student, otherStudent] = users;
  const { rows: teacherProfiles } = await pool.query('INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,$2,$3),($4,$5,$6) RETURNING id,user_id',
    [teacher.id,'Teacher','Origin',otherTeacher.id,'Teacher','Other']);
  const { rows: studentProfiles } = await pool.query('INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,$2,$3,$4),($5,$6,$7,$8) RETURNING id,user_id',
    [student.id,'Student','Origin',name('STU'),otherStudent.id,'Student','Other',name('STU')]);
  const { rows: subjects } = await pool.query('INSERT INTO subjects(name) VALUES ($1),($2) RETURNING id', [name('subject'),name('subject')]);
  const { rows: groups } = await pool.query('INSERT INTO academic_groups(academic_year,curriculum_semester,name) VALUES (2098,1,$1), (2098,1,$2) RETURNING id', [name('group'),name('group')]);
  const origin = { subject:subjects[0].id, group:groups[0].id }, other = { subject:subjects[1].id, group:groups[1].id };
  for (const ctx of [origin,other]) await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id) VALUES ($1,$2)', [ctx.subject,ctx.group]);
  await pool.query(`INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$7,$4,clock_timestamp())`, [teacherProfiles[0].id,origin.subject,origin.group,admin.id,teacherProfiles[1].id,other.subject,other.group]);
  const { rows: periods } = await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$7,$4,clock_timestamp()) RETURNING id,student_id`,
  [studentProfiles[0].id,origin.subject,origin.group,admin.id,studentProfiles[1].id,other.subject,other.group]);
  const { rows: patients } = await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion)
    VALUES ($1,'Current','Patient','2000-02-29',$2,'00000000','F','Current address') RETURNING id`,
  [String(10000000 + serial),`${name('patient')}@example.test`]);
  const { rows: assignments } = await pool.query(`INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by)
    VALUES ($1,$2,$3,$4),($1,$5,$6,$7) RETURNING id,student_habilitation_id`,
  [patients[0].id,periods[0].id,origin.subject,teacher.id,periods[1].id,other.subject,otherTeacher.id]);
  return { admin,teacher,otherTeacher,student,otherStudent,patient:patients[0].id,origin,other,period:periods[0].id,otherPeriod:periods[1].id,assignments };
}
async function token(actor) {
  return new JwtTokenService({secret:config.jwtSecret,secretKid:config.jwtSecretKid,previousSecrets:config.jwtPreviousSecrets,expiresIn:config.jwtExpiresIn})
    .sign({role:actor.role,sub:actor.id,username:actor.username});
}
async function request(method,path,jwt,body) {
  const response = await fetch(`${baseUrl}${path}`, {method,headers:{...(jwt?{authorization:`Bearer ${jwt}`} : {}),...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(9000)});
  const text=await response.text(); return {status:response.status,body:text?JSON.parse(text):undefined};
}
const createBody = f => ({patient_id:f.patient,subject_id:f.origin.subject,academic_group_id:f.origin.group,content:{}});
async function countDocuments(patient) {
  const { rows } = await pool.query(`SELECT (SELECT count(*)::int FROM clinical_records WHERE patient_id=$1) histories,
    (SELECT count(*)::int FROM kinesiology_evaluations WHERE patient_id=$1) evaluations`, [patient]);
  return rows[0];
}

before(async () => {
  try {
    const databaseUrl = await readonlyPreflight();
    for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('PG') || key.toUpperCase()==='NODE_PG_FORCE_NATIVE') delete process.env[key];
    const options='-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000';
    process.env.DATABASE_URL=databaseUrl; process.env.PGOPTIONS=options; process.env.JWT_PREVIOUS_SECRETS??='[]'; process.env.PORT='0';
    ({default:config}=await import('../../src/config.ts'));
    ({JwtTokenService}=await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
    ({cleanDb}=await import('./helpers/clean-db.js'));
    const {createApp}=await import('../../src/app.ts');
    pool=new pg.Pool({connectionString:databaseUrl,application_name:APP_NAME,max:12,connectionTimeoutMillis:TIMEOUT,statement_timeout:TIMEOUT,query_timeout:TIMEOUT+1000,
      lock_timeout:TIMEOUT,idle_in_transaction_session_timeout:TIMEOUT,options});
    const {rows}=await pool.query('SELECT name FROM public.schema_migrations ORDER BY name');
    assert.deepEqual(rows.map(row=>row.name),MIGRATIONS,'migration ledger changed after read-only preflight');
    cleanupAuthorized=true;
    await cleanDb(pool);
    server=createApp(pool).listen(0,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    baseUrl=`http://127.0.0.1:${server.address().port}`;
  } catch (error) { throw new Error(`integration preflight/setup failed: ${safeMessage(error)}`); }
});
beforeEach(async()=>{if(cleanupAuthorized) await cleanDb(pool);});
after(async()=>{
  const errors=[];
  if(pool&&cleanupAuthorized) try { await cleanDb(pool); } catch(error) { errors.push(new Error(`fixture cleanup failed: ${safeMessage(error)}`)); }
  if(server) try { await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())); } catch(error) { errors.push(new Error(`HTTP server close failed: ${safeMessage(error)}`)); }
  if(pool) try { await pool.end(); } catch(error) { errors.push(new Error(`pool close failed: ${safeMessage(error)}`)); }
  if(errors.length) throw new AggregateError(errors,'kinesiology integration teardown failed');
});

test('public draft create/edit/detail/list preserve context, audit, current demographics and reuse one longitudinal history',async()=>{
  const f=await fixture(), jwt=await token(f.student);
  assert.deepEqual(await countDocuments(f.patient),{histories:0,evaluations:0},'reads/fixture setup do not create clinical history');
  const initial=await Promise.all([
    request('POST','/kinesiology-evaluations',jwt,createBody(f)),
    request('POST','/kinesiology-evaluations',jwt,createBody(f)),
  ]);
  assert.deepEqual(initial.map(result=>result.status),[201,201]);
  assert.notEqual(initial[0].body.id,initial[1].body.id);
  assert.equal(initial[0].body.clinical_record_id,initial[1].body.clinical_record_id);
  const first=initial[0];
  assert.equal(first.status,201); assert.equal(typeof first.body.id,'string'); assert.match(first.body.id,/^[1-9][0-9]*$/);
  assert.equal(first.body.author_id,f.student.id); assert.equal(first.body.patient_id,f.patient);
  assert.equal(first.body.origin_student_habilitation_id,f.period); assert.equal(first.body.origin_subject_id,f.origin.subject); assert.equal(first.body.origin_group_id,f.origin.group);
  assert.match(first.body.clinical_record_id,/^[1-9][0-9]*$/); assert.equal(first.body.status,'draft'); assert.deepEqual(first.body.content,{});
  assert.deepEqual(first.body.patient,{id:f.patient,documento:first.body.patient.documento,nombres:'Current',apellidos:'Patient',fecha_nacimiento:'2000-02-29',email:first.body.patient.email,celular:'00000000',sexo:'F',direccion:'Current address'});
  const originalAudit=(await pool.query('SELECT id::text id,patient_id,created_by,created_at FROM clinical_records WHERE patient_id=$1',[f.patient])).rows;
  assert.equal(originalAudit.length,1); assert.equal(originalAudit[0].id,first.body.clinical_record_id); assert.equal(originalAudit[0].created_by,f.student.id);
  const patchContent={illness_history:'incomplete draft',antecedents:{hta:null,dbt:false,diu:true},studies:[{type:'image',description:'pending'}]};
  const patched=await request('PATCH',`/kinesiology-evaluations/${first.body.id}`,jwt,{content:patchContent});
  assert.equal(patched.status,200); assert.deepEqual(patched.body.content,patchContent); assert.deepEqual(patched.body.patient,first.body.patient);
  const [detail,list]=await Promise.all([request('GET',`/kinesiology-evaluations/${first.body.id}`,jwt),request('GET',`/kinesiology-evaluations?patient_id=${f.patient}`,jwt)]);
  assert.equal(detail.status,200); assert.deepEqual(detail.body,patched.body);
  assert.deepEqual(list.body.items.map(row=>row.id).sort(),initial.map(result=>result.body.id).sort());
  const second=await request('POST','/kinesiology-evaluations',jwt,createBody(f));
  assert.equal(second.status,201); assert.notEqual(second.body.id,first.body.id); assert.equal(second.body.clinical_record_id,first.body.clinical_record_id);
  const afterAudit=(await pool.query('SELECT id::text id,patient_id,created_by,created_at FROM clinical_records WHERE patient_id=$1',[f.patient])).rows;
  assert.deepEqual(afterAudit,originalAudit,'reused history must retain original creation audit');
  const concurrent=await Promise.all([
    request('POST','/kinesiology-evaluations',jwt,createBody(f)),
    request('POST','/kinesiology-evaluations',jwt,createBody(f)),
  ]);
  assert.deepEqual(concurrent.map(result=>result.status),[201,201]);
  assert.ok(concurrent.every(result=>result.body.clinical_record_id===first.body.clinical_record_id));
  assert.notEqual(concurrent[0].body.id,concurrent[1].body.id);
  assert.deepEqual(await countDocuments(f.patient),{histories:1,evaluations:5});
});

test('actual SQL authorization protects private drafts across students and requires origin teacher context and fresh grants',async()=>{
  const f=await fixture(), studentJwt=await token(f.student), otherJwt=await token(f.otherStudent), teacherJwt=await token(f.teacher), otherTeacherJwt=await token(f.otherTeacher), adminJwt=await token(f.admin);
  const created=await request('POST','/kinesiology-evaluations',studentJwt,createBody(f)); assert.equal(created.status,201);
  const forbiddenRead=await request('GET',`/kinesiology-evaluations/${created.body.id}`,otherJwt);
  assert.equal(forbiddenRead.status,404); assert.deepEqual(forbiddenRead.body,{error:{code:'NOT_FOUND',message:'evaluation was not found'}});
  const forbiddenList=await request('GET',`/kinesiology-evaluations?patient_id=${f.patient}`,otherJwt);
  assert.equal(forbiddenList.status,200); assert.deepEqual(forbiddenList.body,{items:[]});
  const beforeHiddenPatch=(await pool.query('SELECT id::text id,content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows;
  const hiddenPatch=await request('PATCH',`/kinesiology-evaluations/${created.body.id}`,otherJwt,{content:{illness_history:'intrusion'}});
  assert.equal(hiddenPatch.status,404); assert.deepEqual(hiddenPatch.body,{error:{code:'NOT_FOUND',message:'evaluation was not found'}});
  const afterHiddenPatch=(await pool.query('SELECT id::text id,content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows;
  assert.deepEqual(afterHiddenPatch,beforeHiddenPatch,'hidden foreign PATCH must not change clinical content or timestamps');
  const originRead=await request('GET',`/kinesiology-evaluations/${created.body.id}`,teacherJwt); assert.equal(originRead.status,200);
  assert.deepEqual((await request('GET',`/kinesiology-evaluations?patient_id=${f.patient}`,teacherJwt)).body.items.map(row=>row.id),[created.body.id]);
  assert.equal((await request('GET',`/kinesiology-evaluations/${created.body.id}`,otherTeacherJwt)).status,404);
  assert.equal((await request('PATCH',`/kinesiology-evaluations/${created.body.id}`,teacherJwt,{content:{illness_history:'teacher rewrite'}})).status,403);
  assert.equal((await request('POST','/kinesiology-evaluations',adminJwt,createBody(f))).status,403);
  const before=(await pool.query('SELECT id::text id,content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows;
  await pool.query("DELETE FROM role_permissions WHERE role='estudiante' AND permission IN ('kinesiology-evaluations:read','kinesiology-evaluations:write')");
  try {
    assert.equal((await request('GET',`/kinesiology-evaluations/${created.body.id}`,studentJwt)).status,403);
    assert.equal((await request('PATCH',`/kinesiology-evaluations/${created.body.id}`,studentJwt,{content:{illness_history:'blocked'}})).status,403);
    const unchanged=(await pool.query('SELECT id::text id,content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows;
    assert.deepEqual(unchanged,before);
  } finally {
    await pool.query("INSERT INTO role_permissions(role,permission) SELECT 'estudiante',permission FROM unnest(ARRAY['kinesiology-evaluations:read','kinesiology-evaluations:write']) permission ON CONFLICT DO NOTHING");
  }
  assert.equal((await request('PATCH',`/kinesiology-evaluations/${created.body.id}`,studentJwt,{content:{illness_history:'restored'}})).status,200);
  const after=(await pool.query('SELECT author_id,content FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows[0];
  assert.equal(after.author_id,f.student.id); assert.deepEqual(after.content,{illness_history:'restored'});
  await pool.query('UPDATE patient_assignments SET ended_at=clock_timestamp(),ended_by=$2 WHERE patient_id=$1 AND ended_at IS NULL',[f.patient,f.teacher.id]);
  assert.equal((await request('GET',`/kinesiology-evaluations/${created.body.id}`,studentJwt)).status,404);
  assert.equal((await countDocuments(f.patient)).evaluations,1,'assignment loss removes access but preserves clinical history');
  await pool.query('UPDATE student_academic_habilitations SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE id=$1',[f.period,f.teacher.id]);
  const {rows:replacement}=await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    SELECT id,$2,$3,$4,clock_timestamp() FROM students WHERE user_id=$1 RETURNING id`,[f.student.id,f.origin.subject,f.origin.group,f.admin.id]);
  await pool.query('INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by) VALUES ($1,$2,$3,$4)',[f.patient,replacement[0].id,f.origin.subject,f.teacher.id]);
  assert.equal((await request('GET',`/kinesiology-evaluations/${created.body.id}`,studentJwt)).status,200,'explicit current reassignment restores author read access');
});

test('teacher consent records server-owned attestation and exposes only latest evidence without changing draft prose',async()=>{
  const f=await fixture(), studentJwt=await token(f.student), teacherJwt=await token(f.teacher), otherTeacherJwt=await token(f.otherTeacher);
  const created=await request('POST','/kinesiology-evaluations',studentJwt,{...createBody(f),content:{illness_history:'student-authored clinical prose'}});
  assert.equal(created.status,201);
  const path=`/kinesiology-evaluations/${created.body.id}/consent`;
  const pending=await request('GET',path,studentJwt);
  assert.equal(pending.status,200); assert.deepEqual(pending.body,{evaluation_id:created.body.id,status:'pending',evidence:null});
  assert.deepEqual((await request('GET',path,teacherJwt)).body,{evaluation_id:created.body.id,status:'pending',evidence:null});
  assert.equal((await request('GET',path,otherTeacherJwt)).status,404,'a teacher in another context cannot inspect an unsubmitted draft');
  const before=(await pool.query('SELECT content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows[0];
  const first=await request('POST',path,teacherJwt,{paper_signature_date:'2026-03-08'});
  assert.equal(first.status,201); assert.equal(first.body.status,'verified');
  assert.equal(first.body.evidence.paper_signature_date,'2026-03-08');
  assert.equal(first.body.evidence.verified_by,f.teacher.id);
  assert.match(first.body.evidence.id,/^[1-9][0-9]*$/);
  const firstRow=(await pool.query(`SELECT id::text id,evaluation_id::text evaluation_id,paper_signature_date::text paper_signature_date,
    verified_by,teacher_habilitation_id,verified_at FROM kinesiology_consent_attestations WHERE evaluation_id=$1`,[created.body.id])).rows[0];
  assert.deepEqual(first.body.evidence,{id:firstRow.id,paper_signature_date:firstRow.paper_signature_date,verified_by:firstRow.verified_by,verified_at:firstRow.verified_at.toISOString()});
  assert.deepEqual((await pool.query('SELECT content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows[0],before);
  const second=await request('POST',path,teacherJwt,{paper_signature_date:'2026-03-09'});
  assert.equal(second.status,201); assert.notEqual(second.body.evidence.id,first.body.evidence.id);
  const rows=(await pool.query(`SELECT id::text id,paper_signature_date::text paper_signature_date,verified_by,verified_at
    FROM kinesiology_consent_attestations WHERE evaluation_id=$1 ORDER BY id`,[created.body.id])).rows;
  assert.equal(rows.length,2); assert.equal(rows[0].paper_signature_date,'2026-03-08'); assert.equal(rows[0].verified_by,f.teacher.id);
  assert.equal(rows[1].paper_signature_date,'2026-03-09');
  assert.deepEqual((await request('GET',path,studentJwt)).body,{evaluation_id:created.body.id,status:'verified',evidence:{id:rows[1].id,paper_signature_date:rows[1].paper_signature_date,verified_by:rows[1].verified_by,verified_at:rows[1].verified_at.toISOString()}});
  const detail=await request('GET',`/kinesiology-evaluations/${created.body.id}`,teacherJwt);
  assert.equal(detail.body.content.illness_history,'student-authored clinical prose');
  assert.deepEqual((await pool.query('SELECT content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows[0],before);
  await pool.query('UPDATE patient_assignments SET ended_at=clock_timestamp(),ended_by=$2 WHERE patient_id=$1 AND student_habilitation_id=$3 AND ended_at IS NULL',[f.patient,f.teacher.id,f.period]);
  assert.equal((await request('GET',path,studentJwt)).status,404,'former author loses live access without deleting authorship or evidence');
  assert.equal((await request('GET',path,teacherJwt)).body.evidence.id,rows[1].id);
  assert.deepEqual((await pool.query('SELECT content,updated_at FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows[0],before);
});

test('consent verification requires a fresh teacher grant and active origin context',async()=>{
  const f=await fixture(), jwt=await token(f.teacher);
  const created=await request('POST','/kinesiology-evaluations',await token(f.student),createBody(f)); assert.equal(created.status,201);
  const path=`/kinesiology-evaluations/${created.body.id}/consent`;
  await pool.query("DELETE FROM role_permissions WHERE role='teacher' AND permission='kinesiology-evaluations:verify-consent'");
  try {
    assert.equal((await request('POST',path,jwt,{paper_signature_date:'2026-01-01'})).status,403);
    assert.equal((await pool.query('SELECT count(*)::int n FROM kinesiology_consent_attestations WHERE evaluation_id=$1',[created.body.id])).rows[0].n,0);
  } finally {
    await pool.query("INSERT INTO role_permissions(role,permission) VALUES ('teacher','kinesiology-evaluations:verify-consent') ON CONFLICT DO NOTHING");
  }
  await pool.query('UPDATE teacher_academic_habilitations SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE teacher_id=(SELECT id FROM teachers WHERE user_id=$1) AND subject_id=$3 AND academic_group_id=$4 AND revoked_at IS NULL',[f.teacher.id,f.admin.id,f.origin.subject,f.origin.group]);
  const denied=await request('POST',path,jwt,{paper_signature_date:'2026-01-01'});
  assert.equal(denied.status,404);
  assert.deepEqual(denied.body,{error:{code:'NOT_FOUND',message:'evaluation was not found'}});
  const missing=await request('POST','/kinesiology-evaluations/9223372036854775807/consent',jwt,{paper_signature_date:'2026-01-01'});
  assert.deepEqual(missing,denied,'revoked teacher cannot distinguish a private target from a missing one');
  const foreign=await request('POST',path,await token(f.otherTeacher),{paper_signature_date:'2026-01-01'});
  assert.deepEqual(foreign,denied,'non-origin teacher gets the same private response');
  assert.equal((await pool.query('SELECT count(*)::int n FROM kinesiology_consent_attestations WHERE evaluation_id=$1',[created.body.id])).rows[0].n,0);
});

async function waitForWaiter(fragment) {
  const deadline=Date.now()+4000;
  while(Date.now()<deadline) {
    const {rows}=await pool.query(`SELECT pid FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name=$1
      AND state='active' AND wait_event_type='Lock' AND query ILIKE $2 LIMIT 1`,[APP_NAME,`%${fragment}%`]);
    if(rows.length) return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.fail(`timed out observing application connection waiting on ${fragment}`);
}
test('teacher consent waits on origin-period lock and rejects after revocation wins',async()=>{
  const f=await fixture(), teacherJwt=await token(f.teacher), studentJwt=await token(f.student), blocker=await pool.connect();
  const created=await request('POST','/kinesiology-evaluations',studentJwt,createBody(f)); assert.equal(created.status,201);
  const path=`/kinesiology-evaluations/${created.body.id}/consent`;
  let transaction=false,pending;
  try {
    await blocker.query('BEGIN'); transaction=true;
    await blocker.query(`UPDATE teacher_academic_habilitations SET revoked_at=clock_timestamp(),revoked_by=$2
      WHERE teacher_id=(SELECT id FROM teachers WHERE user_id=$1) AND subject_id=$3 AND academic_group_id=$4 AND revoked_at IS NULL`,[f.teacher.id,f.admin.id,f.origin.subject,f.origin.group]);
    pending=request('POST',path,teacherJwt,{paper_signature_date:'2026-01-01'});
    await waitForWaiter('teacher_academic_habilitations th ON th.teacher_id = t.id');
    await blocker.query('COMMIT'); transaction=false;
    const rejected=await pending;
    assert.equal(rejected.status,404);
    assert.deepEqual(rejected.body,{error:{code:'NOT_FOUND',message:'evaluation was not found'}});
    assert.deepEqual((await pool.query('SELECT count(*)::int n FROM kinesiology_consent_attestations WHERE evaluation_id=$1',[created.body.id])).rows[0],{n:0});
    assert.deepEqual((await pool.query('SELECT content FROM kinesiology_evaluations WHERE id=$1',[created.body.id])).rows[0].content,{});
  } finally {
    if(transaction) try { await blocker.query('ROLLBACK'); } catch {}
    if(pending) await Promise.race([pending.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,6000))]);
    blocker.release();
  }
});

test('draft creation waits on student-period lock and revalidates revocation before commit',async()=>{
  const f=await fixture(), jwt=await token(f.student), blocker=await pool.connect();
  let transaction=false, pending;
  try {
    await blocker.query('BEGIN'); transaction=true;
    await blocker.query('UPDATE student_academic_habilitations SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE id=$1',[f.period,f.teacher.id]);
    pending=request('POST','/kinesiology-evaluations',jwt,createBody(f));
    await waitForWaiter('FROM student_academic_habilitations');
    await blocker.query('COMMIT'); transaction=false;
    const rejected=await pending;
    assert.equal(rejected.status,403);
    assert.deepEqual(await countDocuments(f.patient),{histories:0,evaluations:0});
  } finally {
    if(transaction) try { await blocker.query('ROLLBACK'); } catch {}
    if(pending) await Promise.race([pending.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,6000))]);
    blocker.release();
  }
});
