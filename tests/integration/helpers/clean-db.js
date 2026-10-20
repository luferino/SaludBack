/**
 * FK-safe cleanup for the shared integration test DB (AUD-001 / PR 4 task 4.2).
 *
 * Deletes dependent habilitation, profile, catalog and clinical tables BEFORE
 * their parents and users, so no suite's beforeEach()/after() trips a FK
 * constraint on leftover rows. The order below is the contract:
 * `student_academic_habilitations -> teacher_academic_habilitations ->
 * students -> teachers -> subject_academic_groups -> academic_groups ->
 * subjects -> clinical_records -> patients -> password_reset_tokens -> users`.
 * Every integration file runs this in per-test beforeEach() and after().
 *
 * After FK-safe deletes, TRUNCATE the permission-matrix tables
 * (role_permissions, permissions), then re-execute permission seeds 007 and
 * 011–014 so every suite starts from the canonical permission state.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/007_seed_permission_matrix.sql'),
  'utf8',
);
const subjectPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/011_seed_subject_permissions.sql'),
  'utf8',
);
const groupPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/012_seed_group_permissions.sql'),
  'utf8',
);
const subjectGroupPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/013_seed_subject_group_permissions.sql'),
  'utf8',
);
const teacherHabilitationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/014_seed_teacher_habilitation_permissions.sql'),
  'utf8',
);
const teacherHabilitationRevocationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/015_seed_teacher_habilitation_revocation_permission.sql'),
  'utf8',
);
const studentHabilitationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/016_seed_student_habilitation_permissions.sql'),
  'utf8',
);

export async function cleanDb(pool) {
  await pool.query('DELETE FROM student_academic_habilitations');
  await pool.query('DELETE FROM teacher_academic_habilitations');
  await pool.query('DELETE FROM students');
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM subject_academic_groups');
  await pool.query('DELETE FROM academic_groups');
  await pool.query('DELETE FROM subjects');
  await pool.query('DELETE FROM clinical_records');
  await pool.query('DELETE FROM patients');
  await pool.query('DELETE FROM password_reset_tokens');
  await pool.query('DELETE FROM users');
  // Re-seed the permission matrix so every suite starts from the canonical state.
  // TRUNCATE child first (role_permissions FK -> permissions), then parent.
  await pool.query('TRUNCATE role_permissions, permissions RESTART IDENTITY');
  await pool.query(seedSql);
  await pool.query(subjectPermissionSeedSql);
  await pool.query(groupPermissionSeedSql);
  await pool.query(subjectGroupPermissionSeedSql);
  await pool.query(teacherHabilitationPermissionSeedSql);
  await pool.query(teacherHabilitationRevocationPermissionSeedSql);
  await pool.query(studentHabilitationPermissionSeedSql);
}