import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb preserves FK-safe deletion order and restores permission seeds 007 and 011–021 with a fake query pool', async () => {
  const calls = [];
  await cleanDb({ async query(text) { calls.push(text); return { rows: [] }; } });
  assert.deepEqual(calls.slice(0, 13), [
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
  assert.equal(calls[13], 'TRUNCATE role_permissions, permissions RESTART IDENTITY');
  assert.match(calls[14], /INSERT INTO permissions[\s\S]*materias:read/);
  assert.match(calls[15], /subjects:write[\s\S]*subjects:read/);
  assert.match(calls[16], /groups:write[\s\S]*groups:read/);
  assert.match(calls[17], /subject-groups:write[\s\S]*subject-groups:read/);
  assert.match(calls[18], /teacher-habilitations:write/);
  assert.match(calls[19], /teacher-habilitations:revoke/);
  assert.match(calls[20], /student-habilitations:write/);
  assert.match(calls[21], /student-habilitations:revoke/);
  assert.match(calls[22], /patient-assignments:write[\s\S]*patient-assignments:read-own/);
  assert.match(calls[23], /kinesiology-evaluations:read[\s\S]*kinesiology-evaluations:review/);
  assert.equal(calls.length, 24);
});
