/**
 * FK-safe cleanup for the shared integration test DB (AUD-001 / PR 4 task 4.2).
 *
 * Deletes dependent profile, catalog and clinical tables BEFORE their parents
 * and users, so no suite trips a FK constraint on leftover rows. The order below
 * is the contract:
 * `students -> teachers -> subject_academic_groups -> academic_groups ->
 * subjects -> clinical_records -> patients -> password_reset_tokens -> users`.
 * Every integration file runs this in before() and after().
 *
 * After FK-safe deletes, TRUNCATE the permission-matrix tables
 * (role_permissions, permissions) and re-execute the seed migration so every
 * suite starts from the canonical permission state (permission-matrix-in-db).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/007_seed_permission_matrix.sql'),
  'utf8',
);

export async function cleanDb(pool) {
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
}