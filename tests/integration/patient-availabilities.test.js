import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PgUnitOfWork } from '../../src/modules/shared/infrastructure/pg-unit-of-work.ts';
import { PgPatientAvailabilityRepository } from '../../src/modules/patient-availabilities/index.ts';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

// Optional legacy route retains its pre-created fixture UUID contract. The
// isolated runner uses a distinct read-only disposable preflight and claims no CRUD proof.
const url = process.env.PATIENT_AVAILABILITY_DISPOSABLE_DATABASE_URL;
const fixture = {
  patientId: process.env.PATIENT_AVAILABILITY_FIXTURE_PATIENT_ID,
  subjectId: process.env.PATIENT_AVAILABILITY_FIXTURE_SUBJECT_ID,
  groupId: process.env.PATIENT_AVAILABILITY_FIXTURE_GROUP_ID,
  actorId: process.env.PATIENT_AVAILABILITY_FIXTURE_ACTOR_ID,
};
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

test('Opt-in PostgreSQL disposable-target preflight only (no concurrency assertions)', { skip: !url }, async () => {
  const isolated = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
  if (isolated) await verifyDisposableIntegrationTarget();
  else {
    assert.ok(Object.values(fixture).every(uuid), 'explicit pre-created fixture UUIDs are required');
  }
  const target = new URL(url);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && target.username && target.password);
  if (!isolated) {
    assert.equal(target.hostname, 'localhost'); assert.equal(target.port, '5432'); assert.match(target.pathname, /_test$/);
  } else assert.equal(process.env.DATABASE_URL, url);
  const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000, options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000' });
  try {
    const { rows } = await pool.query("SELECT current_database() AS name, current_setting('transaction_read_only') AS read_only");
    assert.equal(rows[0].name, decodeURIComponent(target.pathname.slice(1))); assert.equal(rows[0].read_only, 'on');
    const { rows: migrations } = await pool.query("SELECT name FROM schema_migrations WHERE name IN ('029_create_patient_context_availabilities.sql','030_seed_patient_availability_permissions.sql')");
    assert.equal(migrations.length, 2);
    // A real concurrency run requires write access to explicitly disposable DB
    // state. This read-only preflight deliberately stops before mutation; race
    // behavior is covered with fake PgUnitOfWork tests, not claimed as proven.
  } finally { await pool.end(); }
});

// Writes fixtures only under the explicit disposable-target guard; every created row is removed in finally.
test('assignable listing excludes patients actively assigned in any group of the subject and keeps ended assignments', { skip: !(url && process.env.DISPOSABLE_INTEGRATION_TARGET === 'true') }, async () => {
  await verifyDisposableIntegrationTarget();
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
  const repo = new PgPatientAvailabilityRepository(new PgUnitOfWork(pool), pool);
  const ids = { users: [], students: [], habilitations: [], teachers: [], subjects: [], groups: [], patients: [] };
  const insert = async (sql, params) => (await pool.query(sql, params)).rows[0].id;
  try {
    const tag = randomUUID().replaceAll('-', '').slice(0, 12);
    const career = (await pool.query("SELECT id FROM careers WHERE code = 'kinesiology'")).rows[0].id;
    const user = async (role, label) => { const id = await insert('INSERT INTO users(username,password_hash,role) VALUES ($1,$2,$3) RETURNING id', [`av-${label}-${tag}`, 'unused-hash', role]); ids.users.push(id); return id; };
    const admin = await user('admin', 'admin'), teacher = await user('teacher', 'teacher'), studentUserA = await user('estudiante', 'stua'), studentUserB = await user('estudiante', 'stub');
    const teacherId = await insert('INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,$2,$3) RETURNING id', [teacher, 'Teacher', 'Availability']); ids.teachers.push(teacherId);
    const studentA = await insert('INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,$2,$3,$4) RETURNING id', [studentUserA, 'Student', 'A', `AVA${tag}`]); ids.students.push(studentA);
    const studentB = await insert('INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,$2,$3,$4) RETURNING id', [studentUserB, 'Student', 'B', `AVB${tag}`]); ids.students.push(studentB);
    const subject = await insert('INSERT INTO subjects(name,career_id) VALUES ($1,$2) RETURNING id', [`av-subject-${tag}`, career]); ids.subjects.push(subject);
    const groupA = await insert('INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,$1,$2) RETURNING id', [`av-a-${tag}`, career]); ids.groups.push(groupA);
    const groupB = await insert('INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,$1,$2) RETURNING id', [`av-b-${tag}`, career]); ids.groups.push(groupB);
    for (const group of [groupA, groupB]) await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) VALUES ($1,$2,$3)', [subject, group, career]);
    await pool.query('INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp())', [teacherId, subject, groupA, admin]);
    const habA = await insert('INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id', [studentA, subject, groupA, admin]); ids.habilitations.push(habA);
    const habB = await insert('INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at) VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id', [studentB, subject, groupB, admin]); ids.habilitations.push(habB);
    const patient = async (apellidos) => { const id = await insert("INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion) VALUES ($1,'Availability',$2,'2000-01-01',$3,'00000000','F','fixture') RETURNING id", [`AV-${tag}-${apellidos}`, apellidos, `av-${tag}-${apellidos}@example.test`]); ids.patients.push(id); return id; };
    // Sorted by apellidos: Assigned, Ended, Free, OtherGroup.
    const assigned = await patient('Assigned'), ended = await patient('Ended'), free = await patient('Free'), otherGroup = await patient('OtherGroup');
    for (const patientId of [assigned, ended, free, otherGroup]) await repo.enable({ patientId, subjectId: subject, groupId: groupA, actorId: admin });
    await pool.query('INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by) VALUES ($1,$2,$3,$4)', [assigned, habA, subject, admin]);
    await pool.query("INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by,assigned_at,ended_by,ended_at,end_reason) VALUES ($1,$2,$3,$4,'2026-01-01T00:00:00Z',$4,'2026-02-01T00:00:00Z','fixture end')", [ended, habA, subject, admin]);
    await pool.query('INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by) VALUES ($1,$2,$3,$4)', [otherGroup, habB, subject, admin]);
    const listed = async (limit, assignable) => (await repo.listTeacher(teacher, subject, groupA, limit, 0, assignable)).map(row => row.patient_id);
    assert.deepEqual(await listed(50, false), [assigned, ended, free, otherGroup]);
    assert.deepEqual(await listed(50, true), [ended, free]);
    // Pagination applies after the filter: the excluded assigned patient must not consume the first slot.
    assert.deepEqual(await listed(1, true), [ended]);
  } finally {
    try {
      await pool.query('DELETE FROM patient_assignments WHERE patient_id = ANY($1::uuid[])', [ids.patients]);
      await pool.query('DELETE FROM patient_context_availabilities WHERE patient_id = ANY($1::uuid[])', [ids.patients]);
      await pool.query('DELETE FROM student_academic_habilitations WHERE id = ANY($1::uuid[])', [ids.habilitations]);
      await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [ids.students]);
      await pool.query('DELETE FROM teacher_academic_habilitations WHERE subject_id = ANY($1::uuid[])', [ids.subjects]);
      await pool.query('DELETE FROM teachers WHERE id = ANY($1::uuid[])', [ids.teachers]);
      await pool.query('DELETE FROM subject_academic_groups WHERE subject_id = ANY($1::uuid[])', [ids.subjects]);
      await pool.query('DELETE FROM academic_groups WHERE id = ANY($1::uuid[])', [ids.groups]);
      await pool.query('DELETE FROM subjects WHERE id = ANY($1::uuid[])', [ids.subjects]);
      await pool.query('DELETE FROM patients WHERE id = ANY($1::uuid[])', [ids.patients]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids.users]);
    } finally { await pool.end(); }
  }
});
