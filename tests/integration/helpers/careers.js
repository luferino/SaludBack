/**
 * Migration 036 seeds the kinesiology career with a generated UUID, so suites
 * resolve its id from the database instead of hardcoding it. Cleanup never
 * deletes careers, so the id is stable for the whole run.
 */
export async function kinesiologyCareerId(pool) {
  const { rows } = await pool.query("SELECT id FROM careers WHERE code = 'kinesiology'");
  if (rows.length !== 1) throw new Error('kinesiology career must be seeded exactly once by migration 036');
  return rows[0].id;
}
