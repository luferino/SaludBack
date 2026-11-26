import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const enabled = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
const PERSONAL_KEYS = ['marital_status', 'medical_insurance'];
const PERSONAL_VIEW_KEYS = ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'sexo', 'direccion', ...PERSONAL_KEYS];

const json = async (response) => ({ status: response.status, body: await response.json() });

test('patient personal data is available only through the authorized public patient interfaces', { skip: !enabled, timeout: 30000 }, async () => {
  const target = await verifyDisposableIntegrationTarget();
  const pool = new pg.Pool({ connectionString: process.env.DISPOSABLE_INTEGRATION_DATABASE_URL,
    max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000,
    options: '-c search_path=pg_catalog,public,pg_temp -c lock_timeout=5000 -c idle_in_transaction_session_timeout=10000' });
  const ids = Object.fromEntries(['admin', 'reception', 'student', 'otherStudent', 'teacher', 'otherTeacher', 'patient', 'unassignedPatient', 'revokedPatient', 'endedPatient', 'subject', 'group', 'otherSubject', 'otherGroup', 'studentHab', 'revokedHab', 'endedHab', 'teacherHab', 'otherTeacherHab'].map(key => [key, randomUUID()]));
  const username = Object.fromEntries(['admin', 'reception', 'student', 'otherStudent', 'teacher', 'otherTeacher'].map(key => [key, `personal_${key}_${randomUUID().replaceAll('-', '')}`]));
  const tokens = {};
  let server;
  let primaryError;
  try {
    const identity = await pool.query(`SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
      inet_server_addr()::text AS address, inet_server_port() AS port`);
    const norm = value => value?.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase() ?? '';
    assert.deepEqual({ ...identity.rows[0], address: norm(identity.rows[0].address) }, {
      name: target.identity.databaseName, oid: target.identity.databaseOid, owner: target.identity.databaseOwner,
      address: norm(target.identity.serverAddress), port: target.identity.serverPort,
    });
    const ledger = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    assert.equal(ledger.rowCount, 64);
    assert.equal(ledger.rows.at(-3).name, '061_add_patient_personal_data.sql');
    assert.equal(ledger.rows.at(-2).name, '062_seed_patient_personal_data_permissions.sql');
    assert.equal(ledger.rows.at(-1).name, '064_seed_reception_availability_read_permission.sql');

    await pool.query(`INSERT INTO users(id,username,password_hash,role) VALUES
      ($1,$2,'synthetic','admin'),($3,$4,'synthetic','reception'),($5,$6,'synthetic','estudiante'),
      ($7,$8,'synthetic','estudiante'),($9,$10,'synthetic','teacher'),($11,$12,'synthetic','teacher')`,
    [ids.admin, username.admin, ids.reception, username.reception, ids.student, username.student,
      ids.otherStudent, username.otherStudent, ids.teacher, username.teacher, ids.otherTeacher, username.otherTeacher]);
    await pool.query(`INSERT INTO reception_career_grants(user_id,career_id,granted_by)
      SELECT $1,id,$2 FROM careers WHERE code='kinesiology'`, [ids.reception, ids.admin]);
    await pool.query(`INSERT INTO students(id,user_id,nombres,apellidos,codalumno,email,celular) VALUES
      ($1,$2,'Ada','Student','PS001','student-private@example.invalid','111'),
      ($3,$4,'Una','Unassigned','PS002','other-private@example.invalid','222')`,
    [ids.student, ids.student, ids.otherStudent, ids.otherStudent]);
    await pool.query(`INSERT INTO teachers(id,user_id,nombres,apellidos,email,celular) VALUES
      ($1,$2,'Tess','Teacher','teacher-private@example.invalid','333'),
      ($3,$4,'Other','Teacher','other-teacher@example.invalid','444')`,
    [ids.teacher, ids.teacher, ids.otherTeacher, ids.otherTeacher]);
    await pool.query(`INSERT INTO subjects(id,name,career_id) VALUES
      ($1,'personal-data-subject',(SELECT id FROM careers WHERE code='kinesiology')),
      ($2,'personal-data-other-subject',(SELECT id FROM careers WHERE code='kinesiology'))`, [ids.subject, ids.otherSubject]);
    await pool.query(`INSERT INTO academic_groups(id,academic_year,curriculum_semester,name,career_id) VALUES
      ($1,2098,1,'personal-data-group',(SELECT id FROM careers WHERE code='kinesiology')),
      ($2,2098,1,'personal-data-other-group',(SELECT id FROM careers WHERE code='kinesiology'))`, [ids.group, ids.otherGroup]);
    await pool.query(`INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id)
      SELECT $1::uuid,$2::uuid,id FROM careers WHERE code='kinesiology' UNION ALL SELECT $3::uuid,$4::uuid,id FROM careers WHERE code='kinesiology'`,
    [ids.subject, ids.group, ids.otherSubject, ids.otherGroup]);
    await pool.query(`INSERT INTO student_academic_habilitations(id,student_id,subject_id,academic_group_id,activated_by,activated_at,revoked_by,revoked_at) VALUES
      ($1,$2,$3,$4,$5,clock_timestamp(),NULL,NULL),
      ($6,$2,$3,$4,$5,clock_timestamp(),$5,clock_timestamp()),
      ($7,$2,$8,$9,$5,clock_timestamp(),NULL,NULL)`,
    [ids.studentHab, ids.student, ids.subject, ids.group, ids.admin, ids.revokedHab, ids.endedHab, ids.otherSubject, ids.otherGroup]);
    await pool.query(`INSERT INTO teacher_academic_habilitations(id,teacher_id,subject_id,academic_group_id,activated_by,activated_at)
      VALUES ($1,$2,$3,$4,$5,clock_timestamp()),($6,$7,$8,$9,$5,clock_timestamp())`,
    [ids.teacherHab, ids.teacher, ids.subject, ids.group, ids.admin, ids.otherTeacherHab, ids.otherTeacher, ids.otherSubject, ids.otherGroup]);

    const [{ createApp }, { JwtTokenService }] = await Promise.all([
      import('../../src/app.ts'), import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
    ]);
    server = createApp(pool).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const service = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: process.env.JWT_SECRET_KID || 'default', previousSecrets: [], expiresIn: '1h' });
    for (const role of Object.keys(username)) tokens[role] = await service.sign({ role: role === 'student' || role === 'otherStudent' ? 'estudiante' : role === 'otherTeacher' ? 'teacher' : role, sub: ids[role], username: username[role], permissions: [] });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (role, path, method = 'GET', body) => fetch(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const patientBody = (documento, extra = {}) => ({ documento, nombres: 'Lia', apellidos: 'Patient', fecha_nacimiento: '1990-01-02', email: 'patient@example.invalid', celular: '555', sexo: 'F', direccion: 'Original address', ...extra });
    const createdAdmin = await json(await call('admin', '/patients', 'POST', patientBody('710001')));
    assert.equal(createdAdmin.status, 201);
    ids.patient = createdAdmin.body.id;
    assert.equal(createdAdmin.body.marital_status, null, 'omitted existing-record field defaults to null');
    assert.equal(createdAdmin.body.medical_insurance, null);
    const invalidCreate = await json(await call('admin', '/patients', 'POST', patientBody('710000', { medical_insurance: 'unlisted' })));
    assert.deepEqual(invalidCreate, { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'medical_insurance must be ips, police_health, military_health, none or null' } } });
    const noInvalidCreate = await json(await call('admin', '/patients'));
    assert.equal(noInvalidCreate.body.items.some(item => item.documento === '710000'), false);
    const createdReception = await json(await call('reception', '/reception/patients/register', 'POST', { career: 'kinesiology', ...patientBody('710002', { marital_status: 'widowed', medical_insurance: 'police_health' }) }));
    assert.equal(createdReception.status, 201);
    ids.unassignedPatient = createdReception.body.id;
    assert.equal(createdReception.body.marital_status, 'widowed');
    assert.equal(createdReception.body.medical_insurance, 'police_health');

    const personalProjection = body => assert.deepEqual(Object.keys(body).sort(), [...PERSONAL_VIEW_KEYS].sort());
    const adminList = await json(await call('admin', '/patients'));
    assert.equal(adminList.status, 200);
    const adminPatient = adminList.body.items?.find(item => item.id === ids.patient) ?? adminList.body.find?.(item => item.id === ids.patient);
    assert.ok(adminPatient, 'admin list exposes created patient');
    assert.equal(adminPatient.marital_status, null);
    assert.equal(adminPatient.medical_insurance, null);

    const badMarital = await json(await call('admin', `/patients/${ids.patient}`, 'PATCH', { marital_status: 'partnered' }));
    assert.deepEqual(badMarital, { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'marital_status must be single, married, divorced, widowed, civil_union or null' } } });
    const badInsurance = await json(await call('admin', `/patients/${ids.patient}`, 'PATCH', { medical_insurance: 'private' }));
    assert.deepEqual(badInsurance, { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'medical_insurance must be ips, police_health, military_health, none or null' } } });
    const adminUnknownField = await json(await call('admin', `/patients/${ids.patient}`, 'PATCH', { marital_status: 'single', direccion: 'blocked' }));
    assert.deepEqual(adminUnknownField, { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'allowed fields: marital_status, medical_insurance' } } });
    const adminEmptyPatch = await json(await call('admin', `/patients/${ids.patient}`, 'PATCH', {}));
    assert.deepEqual(adminEmptyPatch, { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'at least one of marital_status or medical_insurance is required' } } });
    const beforeRejected = await json(await call('admin', '/patients'));
    const unchanged = beforeRejected.body.items?.find(item => item.id === ids.patient) ?? beforeRejected.body.find(item => item.id === ids.patient);
    assert.deepEqual([unchanged.marital_status, unchanged.medical_insurance], [null, null]);
    for (const [marital_status, medical_insurance] of [['single','ips'],['married','police_health'],['divorced','military_health'],['widowed','none'],['civil_union',null]]) {
      const patched = await json(await call('admin', `/patients/${ids.patient}`, 'PATCH', { marital_status, medical_insurance }));
      assert.equal(patched.status, 200);
      assert.deepEqual([patched.body.marital_status, patched.body.medical_insurance], [marital_status, medical_insurance]);
      const listed = await json(await call('admin', '/patients'));
      const row = listed.body.items?.find(item => item.id === ids.patient) ?? listed.body.find(item => item.id === ids.patient);
      assert.deepEqual([row.marital_status, row.medical_insurance], [marital_status, medical_insurance]);
    }

    const receptionList = await json(await call('reception', '/reception/patients?career=kinesiology'));
    assert.equal(receptionList.status, 200);
    const receptionPatient = receptionList.body.items.find(item => item.id === ids.unassignedPatient);
    assert.ok(receptionPatient);
    assert.equal(receptionPatient.marital_status, 'widowed');
    assert.equal(receptionPatient.medical_insurance, 'police_health');
    const receptionPatch = await json(await call('reception', `/reception/patients/${ids.unassignedPatient}?career=kinesiology`, 'PATCH', { email: 'changed@example.invalid', celular: '777', direccion: 'Changed address', marital_status: 'married' }));
    assert.equal(receptionPatch.status, 200);
    assert.deepEqual([receptionPatch.body.marital_status, receptionPatch.body.medical_insurance, receptionPatch.body.direccion], ['married','police_health','Changed address']);
    const foreignCareer = await json(await call('reception', `/reception/patients/${ids.unassignedPatient}?career=odontology`, 'PATCH', { email: 'scope@example.invalid', celular: '1', direccion: 'No change', marital_status: 'single' }));
    assert.equal(foreignCareer.status, 404);
    const receptionAfter = await json(await call('reception', `/reception/patients/${ids.unassignedPatient}?career=kinesiology`));
    assert.deepEqual([receptionAfter.body.marital_status, receptionAfter.body.medical_insurance, receptionAfter.body.direccion], ['married','police_health','Changed address']);

    for (const [patientKey, documento] of [['revokedPatient', '710004'], ['endedPatient', '710005']]) {
      const created = await json(await call('admin', '/patients', 'POST', patientBody(documento)));
      assert.equal(created.status, 201);
      ids[patientKey] = created.body.id;
    }
    await pool.query(`INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by,assigned_at)
      VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$3,$4,clock_timestamp()),($7,$8,$9,$4,clock_timestamp())`,
    [ids.patient, ids.studentHab, ids.subject, ids.admin, ids.revokedPatient, ids.revokedHab, ids.endedPatient, ids.endedHab, ids.otherSubject]);
    await pool.query('UPDATE patient_assignments SET ended_by=$2,ended_at=clock_timestamp(),end_reason=$3 WHERE patient_id=$1', [ids.endedPatient, ids.admin, 'fixture ended']);

    const studentRead = await json(await call('student', `/patients/${ids.patient}/personal-data`));
    assert.equal(studentRead.status, 200);
    personalProjection(studentRead.body);
    assert.equal(Object.hasOwn(studentRead.body, 'email'), false);
    assert.equal(Object.hasOwn(studentRead.body, 'celular'), false);
    assert.deepEqual([studentRead.body.marital_status, studentRead.body.medical_insurance], ['civil_union', null]);
    const studentPatch = await json(await call('student', `/patients/${ids.patient}/personal-data`, 'PATCH', { medical_insurance: 'none' }));
    assert.equal(studentPatch.status, 200);
    personalProjection(studentPatch.body);
    assert.deepEqual([studentPatch.body.marital_status, studentPatch.body.medical_insurance], ['civil_union', 'none']);
    const studentListed = await json(await call('admin', '/patients'));
    const storedViaPublicRead = studentListed.body.items?.find(item => item.id === ids.patient) ?? studentListed.body.find(item => item.id === ids.patient);
    assert.deepEqual([storedViaPublicRead.marital_status, storedViaPublicRead.medical_insurance], ['civil_union', 'none']);

    const notFound = { error: { code: 'NOT_FOUND', message: 'patient was not found' } };
    const unassignedRead = await json(await call('otherStudent', `/patients/${ids.patient}/personal-data`));
    assert.deepEqual(unassignedRead, { status: 404, body: notFound });
    for (const patientKey of ['revokedPatient', 'endedPatient']) {
      const before = await json(await call('admin', '/patients'));
      const prior = before.body.items?.find(item => item.id === ids[patientKey]) ?? before.body.find(item => item.id === ids[patientKey]);
      const rejectedRead = await json(await call('student', `/patients/${ids[patientKey]}/personal-data`));
      assert.deepEqual(rejectedRead, { status: 404, body: notFound });
      const rejectedWrite = await json(await call('student', `/patients/${ids[patientKey]}/personal-data`, 'PATCH', { marital_status: 'married' }));
      assert.deepEqual(rejectedWrite, { status: 404, body: notFound });
      const after = await json(await call('admin', '/patients'));
      const current = after.body.items?.find(item => item.id === ids[patientKey]) ?? after.body.find(item => item.id === ids[patientKey]);
      assert.deepEqual([current.marital_status, current.medical_insurance], [prior.marital_status, prior.medical_insurance]);
    }
    const teacherRead = await json(await call('teacher', `/patients/${ids.patient}/personal-data`));
    assert.equal(teacherRead.status, 200);
    personalProjection(teacherRead.body);
    assert.equal(Object.hasOwn(teacherRead.body, 'email'), false);
    assert.equal(Object.hasOwn(teacherRead.body, 'celular'), false);
    const teacherPatch = await json(await call('teacher', `/patients/${ids.patient}/personal-data`, 'PATCH', { marital_status: 'single' }));
    assert.deepEqual(teacherPatch, { status: 403, body: { error: { code: 'FORBIDDEN', message: "Permission 'patient-personal-data:write' required" } } });
    const noContext = await json(await call('otherTeacher', `/patients/${ids.patient}/personal-data`));
    assert.deepEqual(noContext, { status: 404, body: notFound });
    const unknownPatient = await json(await call('student', `/patients/${randomUUID()}/personal-data`));
    assert.deepEqual(unknownPatient, { status: 404, body: notFound });

    const unknownField = await json(await call('student', `/patients/${ids.patient}/personal-data`, 'PATCH', { marital_status: 'single', direccion: 'blocked' }));
    assert.deepEqual(unknownField, { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'allowed fields: marital_status, medical_insurance' } } });
    const emptyPatch = await json(await call('student', `/patients/${ids.patient}/personal-data`, 'PATCH', {}));
    assert.deepEqual(emptyPatch, { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'at least one of marital_status or medical_insurance is required' } } });
    const afterBadStudentWrites = await json(await call('admin', '/patients'));
    const final = afterBadStudentWrites.body.items?.find(item => item.id === ids.patient) ?? afterBadStudentWrites.body.find(item => item.id === ids.patient);
    assert.deepEqual([final.marital_status, final.medical_insurance], ['civil_union', 'none']);
    const clear = await json(await call('student', `/patients/${ids.patient}/personal-data`, 'PATCH', { marital_status: null }));
    assert.equal(clear.status, 200);
    assert.equal(clear.body.marital_status, null);
    assert.equal(clear.body.medical_insurance, 'none');
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    try {
      await pool.query('DELETE FROM patient_assignments WHERE patient_id=ANY($1::uuid[])', [[ids.patient, ids.unassignedPatient, ids.revokedPatient, ids.endedPatient].filter(Boolean)]);
      await pool.query('DELETE FROM reception_patient_enrollments WHERE patient_id=ANY($1::uuid[]) OR patient_id IN (SELECT id FROM patients WHERE documento IN (\'710001\',\'710002\',\'710003\',\'710004\',\'710005\'))', [[ids.patient, ids.unassignedPatient, ids.revokedPatient, ids.endedPatient].filter(Boolean)]);
      await pool.query('DELETE FROM patients WHERE id=ANY($1::uuid[])', [[ids.patient, ids.unassignedPatient, ids.revokedPatient, ids.endedPatient].filter(Boolean)]);
      await pool.query('DELETE FROM teacher_academic_habilitations WHERE id=ANY($1::uuid[])', [[ids.teacherHab, ids.otherTeacherHab]]);
      await pool.query('DELETE FROM student_academic_habilitations WHERE id=ANY($1::uuid[])', [[ids.studentHab, ids.revokedHab, ids.endedHab]]);
      await pool.query('DELETE FROM subject_academic_groups WHERE subject_id=ANY($1::uuid[]) OR academic_group_id=ANY($2::uuid[])', [[ids.subject, ids.otherSubject], [ids.group, ids.otherGroup]]);
      await pool.query('DELETE FROM subjects WHERE id=ANY($1::uuid[])', [[ids.subject, ids.otherSubject]]);
      await pool.query('DELETE FROM academic_groups WHERE id=ANY($1::uuid[])', [[ids.group, ids.otherGroup]]);
      await pool.query('DELETE FROM reception_career_grants WHERE user_id=$1', [ids.reception]);
      await pool.query('DELETE FROM teachers WHERE id=ANY($1::uuid[])', [[ids.teacher, ids.otherTeacher]]);
      await pool.query('DELETE FROM students WHERE id=ANY($1::uuid[])', [[ids.student, ids.otherStudent]]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[ids.admin, ids.reception, ids.student, ids.otherStudent, ids.teacher, ids.otherTeacher]]);
    } catch (error) { cleanupErrors.push(error); }
    await pool.end();
    if (!primaryError && cleanupErrors.length) primaryError = cleanupErrors[0];
  }
  if (primaryError) throw primaryError;
});
