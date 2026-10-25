import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgPatientAssignmentRepository } from '../../src/modules/patient-assignments/infrastructure/repositories/pg-patient-assignment.repository.ts';

const ACTOR = '40000000-0000-4000-8000-000000000001';
const TEACHER = '50000000-0000-4000-8000-000000000001';
const SUBJECT = '10000000-0000-4000-8000-000000000001';
const GROUP = '20000000-0000-4000-8000-000000000001';
const PERIOD = '60000000-0000-4000-8000-000000000001';
const PATIENT = '70000000-0000-4000-8000-000000000001';
const ASSIGNMENT = { id: '9007199254740993', patient_id: PATIENT, student_habilitation_id: PERIOD,
  subject_id: SUBJECT, academic_group_id: GROUP, assigned_by: ACTOR, assigned_at: new Date('2026-01-01Z'),
  ended_by: null, ended_at: null, end_reason: null };

function fakeUnitOfWork({ available = false } = {}) {
  const state = { available, assignment: { ...ASSIGNMENT }, writes: [], queries: [] };
  const db = { async query(sql, params = []) {
    state.queries.push({ sql, params });
    if (sql.includes('FROM teachers WHERE user_id')) return { rows: [{ id: TEACHER }] };
    if (sql.includes('FROM teacher_academic_habilitations')) return { rows: [{ id: 'context', subject_id: SUBJECT, academic_group_id: GROUP }] };
    if (sql.includes('FROM student_academic_habilitations')) return { rows: [{ id: PERIOD, academic_group_id: GROUP }] };
    if (sql.includes('FROM patients WHERE id')) return { rows: [{ id: PATIENT }] };
    if (sql.includes('FROM patient_context_availabilities')) return { rows: state.available ? [{ patient_id: PATIENT }] : [] };
    if (sql.includes('FROM patient_assignments') && sql.includes('JOIN student_academic_habilitations')) return { rows: [{ ...state.assignment }] };
    if (sql.includes('FROM patient_assignments') && sql.includes('FOR UPDATE')) return { rows: [{ ...state.assignment }] };
    if (sql.includes('UPDATE patient_assignments')) { state.writes.push('end'); return { rows: [{ ...state.assignment }] }; }
    if (sql.includes('INSERT INTO patient_assignments')) { state.writes.push('insert'); return { rows: [{ ...ASSIGNMENT }] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { state, unitOfWork: { async withTransaction(work) { return work(db); } }, pool: db };
}

const input = { patientId: PATIENT, periodId: PERIOD, subjectId: SUBJECT, groupId: GROUP, actorId: ACTOR };
const rejected = error => error?.statusCode === 409 && error?.code === 'CONFLICT'
  && error.message === 'patient is not available in the destination context';

test('create locks context, period, and patient before rejecting an unavailable destination without writes', async () => {
  const fixture = fakeUnitOfWork();
  const repository = new PgPatientAssignmentRepository(fixture.unitOfWork, fixture.pool);
  await assert.rejects(repository.create(input), rejected);
  const sql = fixture.state.queries.map(query => query.sql);
  assert.ok(sql.findIndex(query => query.includes('teacher_academic_habilitations')) < sql.findIndex(query => query.includes('student_academic_habilitations')));
  assert.ok(sql.findIndex(query => query.includes('student_academic_habilitations')) < sql.findIndex(query => query.includes('FROM patients')));
  assert.ok(sql.findIndex(query => query.includes('FROM patients')) < sql.findIndex(query => query.includes('patient_context_availabilities')));
  assert.equal(fixture.state.writes.length, 0);
  assert.equal(sql.some(query => query.includes('INSERT INTO patient_assignments')), false);
});

test('reassignment checks destination availability before source closure and preserves source on rejection', async () => {
  const fixture = fakeUnitOfWork();
  const repository = new PgPatientAssignmentRepository(fixture.unitOfWork, fixture.pool);
  await assert.rejects(repository.reassign(ASSIGNMENT.id, { periodId: PERIOD, subjectId: SUBJECT, groupId: GROUP, actorId: ACTOR }), rejected);
  const sql = fixture.state.queries.map(query => query.sql);
  const patientLock = sql.findIndex(query => query.includes('FROM patients'));
  const availability = sql.findIndex(query => query.includes('patient_context_availabilities'));
  const assignmentLock = sql.findIndex(query => query.includes('FROM patient_assignments') && query.includes('FOR UPDATE'));
  assert.ok(patientLock < availability);
  assert.equal(assignmentLock, -1, 'availability denial must occur before assignment lock');
  assert.equal(fixture.state.assignment.ended_at, null);
  assert.deepEqual(fixture.state.writes, []);
});

test('successful availability lookup is destination-specific and end remains independent of availability', async () => {
  const fixture = fakeUnitOfWork({ available: true });
  const repository = new PgPatientAssignmentRepository(fixture.unitOfWork, fixture.pool);
  const result = await repository.create(input);
  assert.equal(result.academic_group_id, GROUP);
  const availability = fixture.state.queries.find(query => query.sql.includes('patient_context_availabilities'));
  assert.deepEqual(availability.params, [PATIENT, SUBJECT, GROUP]);
  assert.match(availability.sql, /withdrawn_at IS NULL/);

  const noAvailability = fakeUnitOfWork();
  const independent = new PgPatientAssignmentRepository(noAvailability.unitOfWork, noAvailability.pool);
  await independent.end(ASSIGNMENT.id, ACTOR, 'closed');
  assert.equal(noAvailability.state.queries.some(query => query.sql.includes('patient_context_availabilities')), false);
});
