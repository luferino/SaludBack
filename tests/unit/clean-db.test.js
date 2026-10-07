import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb preserves FK-safe deletion order and restores 007 with a fake query pool', async () => {
  const calls = [];
  await cleanDb({ async query(text) { calls.push(text); return { rows: [] }; } });
  assert.deepEqual(calls.slice(0, 11), [
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
  assert.equal(calls[11], 'TRUNCATE role_permissions, permissions RESTART IDENTITY');
  assert.match(calls[12], /INSERT INTO permissions[\s\S]*materias:read/);
});
