import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb checks correction-link privilege and deletes review/submission children before parents', async () => {
  const calls = [];
  await cleanDb({ async query(text) {
    calls.push(text);
    return text.includes('has_column_privilege') ? { rows: [{ allowed: true }] } : { rows: [] };
  } });
  assert.equal(calls[0], "SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed");
  assert.equal(calls[1], 'UPDATE kinesiology_evaluations SET correction_from_submission_id = NULL WHERE correction_from_submission_id IS NOT NULL');
  assert.deepEqual(calls.slice(2, 26), [
    'DELETE FROM kinesiology_evaluation_correction_requests',
    'DELETE FROM kinesiology_evaluation_validation_reviews',
    'DELETE FROM kinesiology_evaluation_amendment_links',
    'DELETE FROM kinesiology_evolution_correction_requests',
    'DELETE FROM kinesiology_evolution_validation_reviews',
    'DELETE FROM kinesiology_evolution_submissions',
    'DELETE FROM kinesiology_evaluation_submission_studies',
    'DELETE FROM kinesiology_evaluation_submissions',
    'DELETE FROM kinesiology_consent_attestations',
    'DELETE FROM kinesiology_evolutions',
    'DELETE FROM kinesiology_evaluations',
    'DELETE FROM patient_assignments',
    'DELETE FROM patient_context_availabilities',
    'DELETE FROM student_academic_habilitations',
    'DELETE FROM teacher_academic_habilitations',
    'DELETE FROM students',
    'DELETE FROM teachers',
    'DELETE FROM subject_academic_groups',
    'DELETE FROM academic_groups',
    'DELETE FROM subjects',
    'DELETE FROM clinical_records',
    'DELETE FROM patients',
    'DELETE FROM password_reset_tokens',
    'DELETE FROM users',
  ]);
  assert.equal(calls[26], 'TRUNCATE role_permissions, permissions RESTART IDENTITY');
  assert.match(calls[27], /INSERT INTO permissions[\s\S]*materias:read/);
  assert.match(calls[28], /subjects:write[\s\S]*subjects:read/);
  assert.match(calls[29], /groups:write[\s\S]*groups:read/);
  assert.match(calls[30], /subject-groups:write[\s\S]*subject-groups:read/);
  assert.match(calls[31], /teacher-habilitations:write/);
  assert.match(calls[32], /teacher-habilitations:revoke/);
  assert.match(calls[33], /student-habilitations:write/);
  assert.match(calls[34], /student-habilitations:revoke/);
  assert.match(calls[35], /patient-assignments:write[\s\S]*patient-assignments:read-own/);
  assert.match(calls[36], /kinesiology-evaluations:read[\s\S]*kinesiology-evaluations:review/);
  assert.match(calls[37], /teachers:read[\s\S]*students:read/);
  assert.match(calls[38], /teacher-habilitations:read[\s\S]*student-habilitations:read/);
  assert.match(calls[39], /patient-availabilities:manage[\s\S]*patient-availabilities:read/);
  assert.match(calls[40], /kinesiology-evolutions:write[\s\S]*teacher/);
  assert.match(calls[41], /kinesiology-evolutions:submit[\s\S]*review/);
  assert.equal(calls.length, 42);
});

test('cleanDb fails closed on missing correction-link UPDATE privilege before any cleanup mutation', async () => {
  const calls = [];
  await assert.rejects(cleanDb({ async query(text) {
    calls.push(text);
    return { rows: [{ allowed: false }] };
  } }), /UPDATE privilege on public\.kinesiology_evaluations\.correction_from_submission_id/);
  assert.deepEqual(calls, ["SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed"]);
  assert.equal(calls.some(sql => /^(UPDATE|DELETE|TRUNCATE)\b|INSERT INTO/.test(sql)), false);
});
