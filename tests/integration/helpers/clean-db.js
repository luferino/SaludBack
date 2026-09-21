/**
 * FK-safe cleanup for the shared integration test DB (AUD-001 / PR 4 task 4.2).
 *
 * Deletes the profile tables (students, teachers, patients) and reset tokens
 * BEFORE users, so no suite's before()/after() ever trips a FK constraint on
 * rows another suite left behind. The order below is the contract:
 * `students -> teachers -> patients -> password_reset_tokens -> users`.
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
  await pool.query('DELETE FROM patients');
  await pool.query('DELETE FROM password_reset_tokens');
  await pool.query('DELETE FROM users');
  // Re-seed the permission matrix so every suite starts from the canonical state.
  // TRUNCATE child first (role_permissions FK -> permissions), then parent.
  await pool.query('TRUNCATE role_permissions, permissions RESTART IDENTITY');
  await pool.query(seedSql);
}