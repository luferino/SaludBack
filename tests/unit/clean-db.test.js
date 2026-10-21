import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb deletes consent attestations before evaluations and restores permission seeds 007 and 011–022 with a fake query pool', async () => {
  const calls = [];
  await cleanDb({ async query(text) { calls.push(text); return { rows: [] }; } });
  assert.deepEqual(calls.slice(0, 14), [
    'DELETE FROM kinesiology_consent_attestations',
    'DELETE FROM kinesiology_evaluations',
    'DELETE FROM patient_assignments',
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
  assert.equal(calls[14], 'TRUNCATE role_permissions, permissions RESTART IDENTITY');
  assert.match(calls[15], /INSERT INTO permissions[\s\S]*materias:read/);
  assert.match(calls[16], /subjects:write[\s\S]*subjects:read/);
  assert.match(calls[17], /groups:write[\s\S]*groups:read/);
  assert.match(calls[18], /subject-groups:write[\s\S]*subject-groups:read/);
  assert.match(calls[19], /teacher-habilitations:write/);
  assert.match(calls[20], /teacher-habilitations:revoke/);
  assert.match(calls[21], /student-habilitations:write/);
  assert.match(calls[22], /student-habilitations:revoke/);
  assert.match(calls[23], /patient-assignments:write[\s\S]*patient-assignments:read-own/);
  assert.match(calls[24], /kinesiology-evaluations:read[\s\S]*kinesiology-evaluations:review/);
  assert.equal(calls.length, 25);
});
