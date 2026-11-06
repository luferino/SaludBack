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
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const APP_NAME='patient-assignment-lifecycle-integration';
const TIMEOUT=5000;
const MIGRATIONS=Array.from({length:42},(_,i)=>`${String(i+1).padStart(3,'0')}_${[
  'create_users.sql','create_patients.sql','add_email_and_reset_tokens.sql','multi_role_and_audit.sql','user_id_unique_profiles.sql',
  'create_permission_matrix.sql','seed_permission_matrix.sql','create_clinical_records.sql','create_academic_contexts.sql',
  'create_academic_habilitations.sql','seed_subject_permissions.sql','seed_group_permissions.sql','seed_subject_group_permissions.sql',
  'seed_teacher_habilitation_permissions.sql','seed_teacher_habilitation_revocation_permission.sql','seed_student_habilitation_permissions.sql',
  'create_patient_assignments.sql','seed_patient_assignment_permissions.sql','seed_student_habilitation_revocation_permission.sql','create_kinesiology_evaluations.sql','seed_kinesiology_evaluation_permissions.sql','create_kinesiology_consent_attestations.sql','create_kinesiology_submissions.sql','create_kinesiology_correction_requests.sql','create_kinesiology_validation_reviews.sql','create_kinesiology_amendment_links.sql','seed_profile_read_permissions.sql','seed_habilitation_read_permissions.sql','create_patient_context_availabilities.sql','seed_patient_availability_permissions.sql','create_kinesiology_evolutions.sql','seed_kinesiology_evolution_permissions.sql','create_kinesiology_evolution_reviews.sql','seed_kinesiology_evolution_review_permissions.sql','create_kinesiology_evolution_amendment_links.sql','create_careers.sql','seed_career_permissions.sql','create_oral_surgery_subjects.sql','seed_oral_surgery_subject_permissions.sql','create_oral_surgery_drafts.sql','seed_oral_surgery_draft_permissions.sql','create_oral_surgery_consent_declarations.sql'][i]}`);
let pool, server, baseUrl, safeToClean=false;
function address(value){if(!value)return null;const ip=value.replace(/^\[|\]$/g,'').split('/')[0].toLowerCase();return ip.startsWith('::ffff:')?ip.slice(7):ip;}
function loopback(value){const ip=address(value);return ip&&(net.isIP(ip)===4?ip.startsWith('127.'):ip==='::1');}
async function verifyTarget(){
  if(process.env.DISPOSABLE_INTEGRATION_TARGET==='true'){
    await verifyDisposableIntegrationTarget();return process.env.DATABASE_URL;
  }
  const raw=readFileSync('.env.test','utf8').match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)?.[1];
  assert.ok(raw,'.env.test must define DATABASE_URL'); const urlValue=raw.replace(/^(["'])(.*)\1$/,'$2');
  assert.ok(process.env.DATABASE_URL===urlValue,'effective DATABASE_URL must match .env.test');
  const url=new URL(urlValue); const db=decodeURIComponent(url.pathname.slice(1));
  assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&url.username&&url.password&&!url.search&&!url.hash);
  assert.ok(url.hostname.toLowerCase()==='localhost'&&url.port==='5432'&&db==='saludback_test',
    'database target must be exactly localhost:5432/saludback_test');
  assert.doesNotMatch(process.env.NODE_ENV??'',/production/i);
  const dnsRows=await dns.lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
  assert.ok(dnsRows.length&&dnsRows.every(row=>loopback(row.address)),'DNS must resolve only to loopback');
  const c=new pg.Client({connectionString:urlValue,connectionTimeoutMillis:TIMEOUT,statement_timeout:TIMEOUT,query_timeout:TIMEOUT+1000,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000'});
  try{await c.connect();await c.query('BEGIN READ ONLY');const {rows}=await c.query(`SELECT current_database() db,current_user usr,inet_server_addr()::text server,inet_server_port() port,inet_client_addr()::text peer,current_setting('transaction_read_only') ro`);
    assert.ok(rows[0].db===db,'connected database name mismatch');
    assert.ok(rows[0].usr===decodeURIComponent(url.username),'connected database role mismatch');
    assert.ok(Number(rows[0].port)===Number(url.port),'connected database port mismatch');assert.equal(rows[0].ro,'on');
    assert.ok(dnsRows.some(row=>address(row.address)===address(rows[0].server)));for(const ip of [rows[0].server,rows[0].peer,c.connection.stream.remoteAddress,c.connection.stream.localAddress])assert.ok(loopback(ip));
    await c.query('ROLLBACK');const {rows:ledger}=await c.query('SELECT name FROM public.schema_migrations ORDER BY name');assert.deepEqual(ledger.map(r=>r.name),MIGRATIONS);
    const {rows:counts}=await c.query('SELECT (SELECT count(*)::int FROM kinesiology_evolutions) evolutions,(SELECT count(*)::int FROM patient_assignments) assignments,(SELECT count(*)::int FROM users) users');assert.deepEqual(counts[0],{evolutions:0,assignments:0,users:0});
    console.log(`Disposable test DB read-only preflight passed: ${rows[0].db}:${rows[0].port}; ledger=${ledger.length}; assignments=${counts[0].assignments}; users=${counts[0].users}`);
  }finally{await c.end();}return urlValue;
}
function name(prefix){return `${prefix}_${process.pid}_${Math.random().toString(16).slice(2)}`;}
async function fixture(){
  const {rows:users}=await pool.query(`INSERT INTO users(username,password_hash,role) VALUES ($1,'unused','admin'),($2,'unused','teacher'),($3,'unused','estudiante') RETURNING id,role,username`,[name('admin'),name('teacher'),name('student')]);
  const admin=users.find(x=>x.role==='admin'), teacher=users.find(x=>x.role==='teacher'), student=users.find(x=>x.role==='estudiante');
  const {rows:teacherRows}=await pool.query('INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,$2,$3) RETURNING id',[teacher.id,'Teacher','Fixture']);
  const {rows:studentRows}=await pool.query('INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,$2,$3,$4) RETURNING id',[student.id,'Student','Fixture',name('STU').replace(/_/g,'')]);
  const {rows:subjects}=await pool.query("INSERT INTO subjects(name,career_id) VALUES ($1,(SELECT id FROM careers WHERE code='kinesiology')) RETURNING id",[name('subject')]);const ids=[];
  for(const g of ['one','two']){const {rows:a}=await pool.query("INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,$1,(SELECT id FROM careers WHERE code='kinesiology')) RETURNING id",[name(g)]);await pool.query("INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) VALUES ($1,$2,(SELECT id FROM careers WHERE code='kinesiology'))",[subjects[0].id,a[0].id]);
    await pool.query('INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp())',[teacherRows[0].id,subjects[0].id,a[0].id,admin.id]);
    const {rows:p}=await pool.query('INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id',[studentRows[0].id,subjects[0].id,a[0].id,admin.id]);ids.push({subject:subjects[0].id,group:a[0].id,period:p[0].id});}
  const {rows:otherSubjects}=await pool.query("INSERT INTO subjects(name,career_id) VALUES ($1,(SELECT id FROM careers WHERE code='kinesiology')) RETURNING id",[name('other_subject')]);
  const {rows:otherGroups}=await pool.query("INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,$1,(SELECT id FROM careers WHERE code='kinesiology')) RETURNING id",[name('other_group')]);
  await pool.query("INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) VALUES ($1,$2,(SELECT id FROM careers WHERE code='kinesiology'))",[otherSubjects[0].id,otherGroups[0].id]);
  await pool.query('INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp())',[teacherRows[0].id,otherSubjects[0].id,otherGroups[0].id,admin.id]);
  const {rows:otherPeriods}=await pool.query('INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id',[studentRows[0].id,otherSubjects[0].id,otherGroups[0].id,admin.id]);
  const {rows:patients}=await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion) VALUES ($1,'Patient','Fixture','2000-01-01',$2,'00000000','F','Fixture') RETURNING id`,[String(Math.floor(Math.random()*80000000)+10000000),`${name('p')}@example.test`]);
  for (const ctx of ids) await pool.query(`INSERT INTO patient_context_availabilities(patient_id,subject_id,academic_group_id,enabled_by)
    VALUES ($1,$2,$3,$4)`, [patients[0].id,ctx.subject,ctx.group,admin.id]);
  return {admin,teacher,patient:patients[0].id,source:ids[0],target:ids[1],other:{subject:otherSubjects[0].id,group:otherGroups[0].id,period:otherPeriods[0].id}};
}
async function token(actor){return new JwtTokenService({secret:config.jwtSecret,secretKid:config.jwtSecretKid,previousSecrets:config.jwtPreviousSecrets,expiresIn:config.jwtExpiresIn}).sign({role:actor.role,sub:actor.id,username:actor.username});}
async function request(method,path,t,body){const r=await fetch(`${baseUrl}${path}`,{method,headers:{authorization:`Bearer ${t}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(9000)});return {status:r.status,body:await r.json()};}

before(async()=>{const databaseUrl=await verifyTarget();for(const key of Object.keys(process.env))if(key.toUpperCase().startsWith('PG')||key.toUpperCase()==='NODE_PG_FORCE_NATIVE')delete process.env[key];
  const options='-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000';process.env.DATABASE_URL=databaseUrl;process.env.PGOPTIONS=options;process.env.JWT_PREVIOUS_SECRETS??='[]';process.env.PORT='0';
  pool=new pg.Pool({connectionString:databaseUrl,application_name:APP_NAME,max:8,connectionTimeoutMillis:TIMEOUT,statement_timeout:TIMEOUT,query_timeout:TIMEOUT+1000,lock_timeout:TIMEOUT,idle_in_transaction_session_timeout:TIMEOUT,options});
  const {rows}=await pool.query('SELECT name FROM schema_migrations ORDER BY name');assert.deepEqual(rows.map(r=>r.name),MIGRATIONS);safeToClean=true;await cleanDb(pool);
  server=createApp(pool).listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});baseUrl=`http://127.0.0.1:${server.address().port}`;
});
beforeEach(async()=>{if(safeToClean)await cleanDb(pool);});
after(async()=>{const errors=[];if(pool&&safeToClean)try{await cleanDb(pool);const {rows}=await pool.query('SELECT count(*)::int n FROM patient_assignments');assert.equal(rows[0].n,0);}catch(e){errors.push(e);}if(server)try{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}catch(e){errors.push(e);}if(pool)try{await pool.end();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'lifecycle integration cleanup failed');});

test('real PostgreSQL reassignment atomically preserves ended source and creates destination history; manual end audits reason',async()=>{
  const f=await fixture();const t=await token(f.teacher);const created=await request('POST','/patient-assignments',t,{patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});assert.equal(created.status,201);
  const moved=await request('POST',`/patient-assignments/${created.body.id}/reassign`,t,{student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group});assert.equal(moved.status,200);assert.equal(moved.body.student_habilitation_id,f.target.period);
  const {rows}=await pool.query('SELECT id::text id,student_habilitation_id,assigned_by,ended_by,ended_at,end_reason FROM patient_assignments WHERE patient_id=$1 ORDER BY id',[f.patient]);assert.equal(rows.length,2);assert.equal(rows[0].student_habilitation_id,f.source.period);assert.equal(rows[0].ended_by,f.teacher.id);assert.ok(rows[0].ended_at);assert.equal(rows[0].end_reason,null);assert.equal(rows[1].assigned_by,f.teacher.id);assert.equal(rows[1].ended_at,null);
  const ended=await request('POST',`/patient-assignments/${moved.body.id}/end`,t,{end_reason:'  completed  '});assert.equal(ended.status,200);assert.equal(ended.body.end_reason,'completed');assert.equal(ended.body.ended_by,f.teacher.id);assert.ok(ended.body.ended_at);
  const unchanged=await request('POST',`/patient-assignments/${moved.body.id}/end`,t,{end_reason:'overwrite'});assert.equal(unchanged.status,409);const {rows:afterRows}=await pool.query('SELECT ended_by,end_reason,ended_at FROM patient_assignments WHERE id=$1',[moved.body.id]);assert.equal(afterRows[0].end_reason,'completed');assert.equal(afterRows[0].ended_by,f.teacher.id);
});

test('concurrent real PostgreSQL end versus reassignment has one serialized winner and consistent history',async()=>{
  const f=await fixture();const t=await token(f.teacher);const created=await request('POST','/patient-assignments',t,{patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});assert.equal(created.status,201);
  const [ended,moved]=await Promise.all([
    request('POST',`/patient-assignments/${created.body.id}/end`,t,{end_reason:'manual close'}),
    request('POST',`/patient-assignments/${created.body.id}/reassign`,t,{student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group}),
  ]);
  assert.deepEqual([ended.status,moved.status].sort((a,b)=>a-b),[200,409]);
  const {rows}=await pool.query('SELECT student_habilitation_id,ended_by,ended_at,end_reason FROM patient_assignments WHERE patient_id=$1 ORDER BY id',[f.patient]);
  if(ended.status===200){assert.equal(rows.length,1);assert.equal(rows.filter(row=>row.ended_at===null).length,0);assert.equal(rows[0].end_reason,'manual close');}
  else{assert.equal(rows.length,2);assert.equal(rows.filter(row=>row.ended_at===null).length,1);assert.equal(rows[0].end_reason,null);assert.equal(rows[1].student_habilitation_id,f.target.period);assert.equal(rows[1].ended_at,null);}
  assert.ok(rows.filter(row=>row.ended_at!==null).every(row=>row.ended_by===f.teacher.id));
});

test('real PostgreSQL enforces source and destination context for reassignment and source context for ending',async()=>{
  for(const authorizedGroupKind of ['source','destination']){
    const f=await fixture();const ownerToken=await token(f.teacher);const created=await request('POST','/patient-assignments',ownerToken,{patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});assert.equal(created.status,201);
    const username=name('partial_teacher');const {rows:u}=await pool.query("INSERT INTO users(username,password_hash,role) VALUES ($1,'unused','teacher') RETURNING id,username,role",[username]);
    const {rows:t}=await pool.query('INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,$2,$3) RETURNING id',[u[0].id,'Partial','Context']);
    const authorizedGroup=authorizedGroupKind==='source'?f.source.group:f.target.group;
    await pool.query('INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp())',[t[0].id,f.source.subject,authorizedGroup,f.admin.id]);
    const actorToken=await token(u[0]);
    const denied=await request('POST',`/patient-assignments/${created.body.id}/reassign`,actorToken,{student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group});assert.equal(denied.status,403);
    const ending=await request('POST',`/patient-assignments/${created.body.id}/end`,actorToken,{end_reason:'context check'});
    assert.equal(ending.status,authorizedGroupKind==='source'?200:403);
    const {rows}=await pool.query('SELECT count(*)::int count FROM patient_assignments WHERE patient_id=$1',[f.patient]);assert.equal(rows[0].count,1);
  }
});

test('real PostgreSQL fresh permission revocation blocks both lifecycle methods without mutation',async()=>{
  const f=await fixture();const t=await token(f.teacher);const created=await request('POST','/patient-assignments',t,{patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});assert.equal(created.status,201);
  await pool.query("DELETE FROM role_permissions WHERE role='teacher' AND permission='patient-assignments:write'");
  try{
    const reassign=await request('POST',`/patient-assignments/${created.body.id}/reassign`,t,{student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group});assert.equal(reassign.status,403);
    const ended=await request('POST',`/patient-assignments/${created.body.id}/end`,t,{end_reason:'denied'});assert.equal(ended.status,403);
  }finally{
    await pool.query("INSERT INTO role_permissions(role,permission) SELECT 'teacher','patient-assignments:write' WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role='teacher' AND permission='patient-assignments:write')");
  }
  const {rows}=await pool.query('SELECT count(*)::int count, count(*) FILTER (WHERE ended_at IS NOT NULL)::int ended FROM patient_assignments WHERE patient_id=$1',[f.patient]);assert.deepEqual(rows[0],{count:1,ended:0});
});

test('real PostgreSQL rejected cross-subject and malformed reason requests leave assignment rows unchanged',async()=>{
  const f=await fixture();const t=await token(f.teacher);const created=await request('POST','/patient-assignments',t,{patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});assert.equal(created.status,201);
  const before=await pool.query('SELECT id::text,student_habilitation_id,assigned_by,ended_by,ended_at,end_reason FROM patient_assignments WHERE patient_id=$1 ORDER BY id',[f.patient]);
  const invalid=await request('POST',`/patient-assignments/${created.body.id}/reassign`,t,{student_habilitation_id:f.other.period,subject_id:f.other.subject,academic_group_id:f.other.group});assert.equal(invalid.status,400);
  for(const reason of [null,12,'  '])assert.equal((await request('POST',`/patient-assignments/${created.body.id}/end`,t,{end_reason:reason})).status,400);
  const afterRows=await pool.query('SELECT id::text,student_habilitation_id,assigned_by,ended_by,ended_at,end_reason FROM patient_assignments WHERE patient_id=$1 ORDER BY id',[f.patient]);assert.deepEqual(afterRows.rows,before.rows);
});


// These tests require the existing disposable-target preflight and are never
// executed by the database-free unit command. They exercise public API races.
async function activeAvailability(fixture, context, adminToken) {
  const history = await request('GET', `/patient-availabilities/manage?patient_id=${fixture.patient}`, adminToken);
  assert.equal(history.status, 200);
  const period = history.body.items.find(row => row.subject_id === context.subject && row.academic_group_id === context.group && row.withdrawn_at === null);
  assert.ok(period, 'fixture must explicitly enable the requested context');
  return period;
}

test('real PostgreSQL withdrawal versus create serializes on the patient and preserves any winning assignment', async () => {
  const f = await fixture(), teacherToken = await token(f.teacher), adminToken = await token(f.admin);
  const availability = await activeAvailability(f, f.source, adminToken);
  const [withdrawn, created] = await Promise.all([
    request('POST', `/patient-availabilities/${availability.id}/withdraw`, adminToken, {}),
    request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group}),
  ]);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.withdrawn_by, f.admin.id);
  assert.ok(withdrawn.body.withdrawn_at);
  assert.ok([201,409].includes(created.status));
  if (created.status === 409) assert.deepEqual(created.body, {error:{code:'CONFLICT',message:'patient is not available in the destination context'}});
  const visible = await request('GET', '/patient-assignments', teacherToken);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.items.length, created.status === 201 ? 1 : 0);
  if (created.status === 201) assert.equal(visible.body.items[0].id, created.body.id);
  const denied = await request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});
  assert.deepEqual(denied, {status:409,body:{error:{code:'CONFLICT',message:'patient is not available in the destination context'}}});
  const repeated = await request('POST', `/patient-availabilities/${availability.id}/withdraw`, adminToken, {});
  assert.deepEqual(repeated, withdrawn, 'repeat withdrawal cannot rewrite audit facts');
  const after = await request('GET', '/patient-assignments', teacherToken);
  assert.deepEqual(after.body, visible.body, 'denied creation and repeat withdrawal cannot change assignments');
});

test('real PostgreSQL destination withdrawal versus reassignment preserves the serialized winner without partial closure', async () => {
  const f = await fixture(), teacherToken = await token(f.teacher), adminToken = await token(f.admin);
  const created = await request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});
  assert.equal(created.status, 201);
  const destination = await activeAvailability(f, f.target, adminToken);
  const [withdrawn, moved] = await Promise.all([
    request('POST', `/patient-availabilities/${destination.id}/withdraw`, adminToken, {}),
    request('POST', `/patient-assignments/${created.body.id}/reassign`, teacherToken, {student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group}),
  ]);
  assert.equal(withdrawn.status, 200);
  assert.ok([200,409].includes(moved.status));
  if (moved.status === 409) assert.deepEqual(moved.body, {error:{code:'CONFLICT',message:'patient is not available in the destination context'}});
  const visible = await request('GET', '/patient-assignments', teacherToken);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.items.length, 1);
  assert.equal(visible.body.items[0].id, moved.status === 200 ? moved.body.id : created.body.id);
  assert.equal(visible.body.items[0].student_habilitation_id, moved.status === 200 ? f.target.period : f.source.period);
  const {rows} = await pool.query('SELECT id::text id,ended_by,ended_at FROM patient_assignments WHERE patient_id=$1 ORDER BY id', [f.patient]);
  assert.equal(rows.length, moved.status === 200 ? 2 : 1);
  const sourceRow = rows.find(row => row.id === created.body.id);
  assert.ok(sourceRow, 'source assignment history must remain present');
  assert.equal(sourceRow.ended_at === null, moved.status !== 200);
  assert.equal(sourceRow.ended_by, moved.status === 200 ? f.teacher.id : null);
  if (moved.status === 200) {
    const destinationRow = rows.find(row => row.id === moved.body.id);
    assert.ok(destinationRow, 'destination assignment history must remain present');
    assert.equal(destinationRow.ended_at, null);
  }
  const end = await request('POST', `/patient-assignments/${visible.body.items[0].id}/end`, teacherToken, {end_reason:'completed after withdrawal race'});
  assert.equal(end.status, 200, 'withdrawal must never block explicit assignment ending');
});

async function startPatientBlocker(f) {
  const blocker = new pg.Client({
    connectionString: pool.options.connectionString,
    application_name: `${APP_NAME}-blocker-${process.pid}-${Math.random().toString(16).slice(2)}`,
    connectionTimeoutMillis: TIMEOUT,
    statement_timeout: TIMEOUT,
    query_timeout: TIMEOUT + 1000,
    lock_timeout: TIMEOUT,
    idle_in_transaction_session_timeout: TIMEOUT,
    options: '-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000',
  });
  await blocker.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE', [f.patient]);
    return blocker;
  } catch (error) {
    await blocker.query('ROLLBACK').catch(() => {});
    await blocker.end().catch(() => {});
    throw error;
  }
}

async function waitForPatientLockWaiters(count) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`
      SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND usename=current_user AND application_name=$1
        AND state='active' AND wait_event_type='Lock'
        AND query ILIKE '%patient%FOR UPDATE%'
    `, [APP_NAME]);
    if (rows.length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${count} patient FOR UPDATE lock waiter(s)`);
}

async function assignmentRows(patientId) {
  const { rows } = await pool.query(`
    SELECT id::text id, patient_id::text patient_id, student_habilitation_id::text student_habilitation_id,
      assigned_by::text assigned_by, assigned_at, ended_by::text ended_by, ended_at, end_reason
    FROM patient_assignments WHERE patient_id=$1 ORDER BY assigned_at,id
  `, [patientId]);
  return rows;
}

async function assignmentActiveCount(patientId) {
  const { rows } = await pool.query('SELECT count(*)::int count, count(*) FILTER (WHERE ended_at IS NULL)::int active FROM patient_assignments WHERE patient_id=$1', [patientId]);
  return rows[0];
}

async function settleRace(blocker, pending) {
  try {
    await blocker.query('ROLLBACK');
  } finally {
    const settled = await Promise.allSettled(pending);
    await blocker.end();
    for (const result of settled) if (result.status === 'rejected') throw result.reason;
  }
}

test('real PostgreSQL forced withdrawal-first blocks create until availability is withdrawn', async () => {
  const f = await fixture(), teacherToken = await token(f.teacher), adminToken = await token(f.admin);
  const availability = await activeAvailability(f, f.source, adminToken);
  const blocker = await startPatientBlocker(f), pending = [];
  try {
    pending.push(request('POST', `/patient-availabilities/${availability.id}/withdraw`, adminToken, {}));
    await waitForPatientLockWaiters(1);
    pending.push(request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group}));
    await waitForPatientLockWaiters(2);
  } finally {
    await settleRace(blocker, pending);
  }
  const [withdrawn, created] = await Promise.all(pending);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.withdrawn_by, f.admin.id);
  assert.ok(withdrawn.body.withdrawn_at);
  assert.deepEqual(created, {status:409,body:{error:{code:'CONFLICT',message:'patient is not available in the destination context'}}});
  const history = await request('GET', `/patient-availabilities/manage?patient_id=${f.patient}`, adminToken);
  assert.equal(history.status, 200);
  const withdrawnPeriod = history.body.items.find(row => row.id === availability.id);
  assert.equal(withdrawnPeriod.withdrawn_by, f.admin.id);
  assert.equal(withdrawnPeriod.withdrawn_at, withdrawn.body.withdrawn_at);
  assert.deepEqual(await assignmentRows(f.patient), []);
  assert.deepEqual(await assignmentActiveCount(f.patient), {count:0,active:0});
});

test('real PostgreSQL forced create-first preserves assignment after subsequent withdrawal', async () => {
  const f = await fixture(), teacherToken = await token(f.teacher), adminToken = await token(f.admin);
  const availability = await activeAvailability(f, f.source, adminToken);
  const blocker = await startPatientBlocker(f), pending = [];
  try {
    pending.push(request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group}));
    await waitForPatientLockWaiters(1);
    pending.push(request('POST', `/patient-availabilities/${availability.id}/withdraw`, adminToken, {}));
    await waitForPatientLockWaiters(2);
  } finally {
    await settleRace(blocker, pending);
  }
  const [created, withdrawn] = await Promise.all(pending);
  assert.equal(created.status, 201);
  assert.equal(created.body.student_habilitation_id, f.source.period);
  assert.equal(created.body.assigned_by, f.teacher.id);
  assert.ok(created.body.assigned_at);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.withdrawn_by, f.admin.id);
  assert.ok(withdrawn.body.withdrawn_at);
  const visible = await request('GET', '/patient-assignments', teacherToken);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.items.length, 1);
  assert.equal(visible.body.items[0].id, created.body.id);
  const rows = await assignmentRows(f.patient);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, created.body.id);
  assert.equal(rows[0].assigned_by, f.teacher.id);
  assert.equal(new Date(rows[0].assigned_at).toISOString(), created.body.assigned_at);
  assert.equal(rows[0].student_habilitation_id, f.source.period);
  assert.equal(rows[0].ended_at, null);
  assert.deepEqual(await assignmentActiveCount(f.patient), {count:1,active:1});
  const ended = await request('POST', `/patient-assignments/${created.body.id}/end`, teacherToken, {end_reason:'explicitly ended after withdrawal'});
  assert.equal(ended.status, 200);
  assert.equal(ended.body.ended_by, f.teacher.id);
});

test('real PostgreSQL forced withdrawal-first blocks reassignment without partially ending source', async () => {
  const f = await fixture(), teacherToken = await token(f.teacher), adminToken = await token(f.admin);
  const created = await request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});
  assert.equal(created.status, 201);
  const beforeRows = await assignmentRows(f.patient), beforeCount = await assignmentActiveCount(f.patient);
  const destination = await activeAvailability(f, f.target, adminToken);
  const blocker = await startPatientBlocker(f), pending = [];
  try {
    pending.push(request('POST', `/patient-availabilities/${destination.id}/withdraw`, adminToken, {}));
    await waitForPatientLockWaiters(1);
    pending.push(request('POST', `/patient-assignments/${created.body.id}/reassign`, teacherToken, {student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group}));
    await waitForPatientLockWaiters(2);
  } finally {
    await settleRace(blocker, pending);
  }
  const [withdrawn, moved] = await Promise.all(pending);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.withdrawn_by, f.admin.id);
  assert.ok(withdrawn.body.withdrawn_at);
  assert.deepEqual(moved, {status:409,body:{error:{code:'CONFLICT',message:'patient is not available in the destination context'}}});
  assert.deepEqual(await assignmentRows(f.patient), beforeRows, 'rejected reassign cannot end or rewrite source history');
  assert.deepEqual(await assignmentActiveCount(f.patient), beforeCount);
  const visible = await request('GET', '/patient-assignments', teacherToken);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.items.length, 1);
  assert.equal(visible.body.items[0].id, created.body.id);
  assert.equal(visible.body.items[0].student_habilitation_id, f.source.period);
});

test('real PostgreSQL forced reassign-first preserves ended source and visible destination after withdrawal', async () => {
  const f = await fixture(), teacherToken = await token(f.teacher), adminToken = await token(f.admin);
  const created = await request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});
  assert.equal(created.status, 201);
  const destination = await activeAvailability(f, f.target, adminToken);
  const blocker = await startPatientBlocker(f), pending = [];
  try {
    pending.push(request('POST', `/patient-assignments/${created.body.id}/reassign`, teacherToken, {student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group}));
    await waitForPatientLockWaiters(1);
    pending.push(request('POST', `/patient-availabilities/${destination.id}/withdraw`, adminToken, {}));
    await waitForPatientLockWaiters(2);
  } finally {
    await settleRace(blocker, pending);
  }
  const [moved, withdrawn] = await Promise.all(pending);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.student_habilitation_id, f.target.period);
  assert.equal(moved.body.assigned_by, f.teacher.id);
  assert.ok(moved.body.assigned_at);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.withdrawn_by, f.admin.id);
  assert.ok(withdrawn.body.withdrawn_at);
  const visible = await request('GET', '/patient-assignments', teacherToken);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.items.length, 1);
  assert.equal(visible.body.items[0].id, moved.body.id);
  assert.equal(visible.body.items[0].student_habilitation_id, f.target.period);
  const rows = await assignmentRows(f.patient);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, created.body.id);
  assert.equal(rows[0].student_habilitation_id, f.source.period);
  assert.equal(rows[0].assigned_by, f.teacher.id);
  assert.equal(rows[0].ended_by, f.teacher.id);
  assert.ok(rows[0].ended_at);
  assert.equal(rows[0].end_reason, null);
  assert.equal(rows[1].id, moved.body.id);
  assert.equal(rows[1].student_habilitation_id, f.target.period);
  assert.equal(rows[1].assigned_by, f.teacher.id);
  assert.equal(new Date(rows[1].assigned_at).toISOString(), moved.body.assigned_at);
  assert.equal(rows[1].ended_at, null);
  assert.deepEqual(await assignmentActiveCount(f.patient), {count:2,active:1});
  const ended = await request('POST', `/patient-assignments/${moved.body.id}/end`, teacherToken, {end_reason:'explicitly ended after withdrawal'});
  assert.equal(ended.status, 200);
  assert.equal(ended.body.ended_by, f.teacher.id);
});


test('real PostgreSQL permits moving an existing assignment out of a withdrawn source into an enabled destination', async () => {
  const f = await fixture(), teacherToken = await token(f.teacher), adminToken = await token(f.admin);
  const created = await request('POST', '/patient-assignments', teacherToken, {patient_id:f.patient,student_habilitation_id:f.source.period,subject_id:f.source.subject,academic_group_id:f.source.group});
  assert.equal(created.status, 201);
  const source = await activeAvailability(f, f.source, adminToken);
  const withdrawn = await request('POST', `/patient-availabilities/${source.id}/withdraw`, adminToken, {});
  assert.equal(withdrawn.status, 200);
  const visible = await request('GET', '/patient-assignments', teacherToken);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.items[0].id, created.body.id);
  const moved = await request('POST', `/patient-assignments/${created.body.id}/reassign`, teacherToken, {student_habilitation_id:f.target.period,subject_id:f.target.subject,academic_group_id:f.target.group});
  assert.equal(moved.status, 200);
  assert.equal(moved.body.student_habilitation_id, f.target.period);
  const {rows} = await pool.query('SELECT id::text id,ended_by,ended_at FROM patient_assignments WHERE patient_id=$1 ORDER BY id', [f.patient]);
  assert.equal(rows.length, 2);
  const sourceRow = rows.find(row => row.id === created.body.id);
  const destinationRow = rows.find(row => row.id === moved.body.id);
  assert.ok(sourceRow, 'source assignment history must remain present');
  assert.ok(destinationRow, 'destination assignment history must remain present');
  assert.equal(sourceRow.ended_by, f.teacher.id);
  assert.ok(sourceRow.ended_at);
  assert.equal(destinationRow.ended_at, null);
});
