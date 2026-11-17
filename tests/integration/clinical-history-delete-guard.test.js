import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const selected = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
const PROTECTED = [
  'kinesiology_consent_attestations', 'kinesiology_evaluation_amendment_links', 'kinesiology_evaluation_correction_requests',
  'kinesiology_evaluation_submission_studies', 'kinesiology_evaluation_submissions', 'kinesiology_evaluation_validation_reviews',
  'kinesiology_evolution_amendment_links', 'kinesiology_evolution_correction_requests', 'kinesiology_evolution_submissions',
  'kinesiology_evolution_validation_reviews', 'oral_surgery_authorizations', 'oral_surgery_consent_declarations',
  'oral_surgery_practical_evaluations',
];
let pool;

before(async () => {
  if (!selected) return;
  await verifyDisposableIntegrationTarget();
  assert.equal(process.env.DATABASE_URL, process.env.DISPOSABLE_INTEGRATION_DATABASE_URL);
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000,
    options: '-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000' });
}, { timeout: 30000 });

after(async () => { if (pool) await pool.end(); });

test('S1/S2: the disposable target rejects every DELETE on exactly the append-only clinical history tables',
  { skip: !selected, timeout: 30000 }, async () => {
    const { rows } = await pool.query(`SELECT c.relname AS table_name
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND t.tgname = 'clinical_history_no_delete' AND NOT t.tgisinternal
       ORDER BY c.relname`);
    assert.deepEqual(rows.map(row => row.table_name), PROTECTED);
    for (const table of PROTECTED) {
      await assert.rejects(pool.query(`DELETE FROM ${table}`),
        error => error.code === '23514' && error.message === `clinical history rows cannot be deleted from ${table}`, table);
    }
    await assert.doesNotReject(pool.query('DELETE FROM oral_surgery_operative_reports WHERE false'));
  });
