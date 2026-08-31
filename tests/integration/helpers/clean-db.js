/**
 * FK-safe cleanup for the shared integration test DB (AUD-001 / PR 4 task 4.2).
 *
 * Deletes the profile tables (students, teachers, patients) and reset tokens
 * BEFORE users, so no suite's before()/after() ever trips a FK constraint on
 * rows another suite left behind. The order below is the contract:
 * `students -> teachers -> patients -> password_reset_tokens -> users`.
 * Every integration file runs this in before() and after().
 *
 * Note: `DELETE FROM users` is a single statement, so Postgres tolerates the
 * self-referencing audit FK (users.created_by -> users.id) without a cascade.
 */
export async function cleanDb(pool) {
  await pool.query('DELETE FROM students');
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM patients');
  await pool.query('DELETE FROM password_reset_tokens');
  await pool.query('DELETE FROM users');
}