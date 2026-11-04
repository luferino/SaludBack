import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const selected = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';

test('generated disposable target exposes the read-only A3 evolution schema', {
  skip: selected ? false : 'requires explicit disposable integration target opt-in',
}, async () => {
  await verifyDisposableIntegrationTarget();
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000',
  });
  try {
    const columns = await pool.query(`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class t ON t.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relname = 'kinesiology_evolutions'
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`);
    assert.deepEqual(columns.rows, [
      { name: 'id', type: 'bigint', not_null: true },
      { name: 'clinical_record_id', type: 'bigint', not_null: true },
      { name: 'patient_id', type: 'uuid', not_null: true },
      { name: 'evaluation_id', type: 'bigint', not_null: true },
      { name: 'author_id', type: 'uuid', not_null: true },
      { name: 'origin_student_habilitation_id', type: 'uuid', not_null: true },
      { name: 'origin_subject_id', type: 'uuid', not_null: true },
      { name: 'origin_group_id', type: 'uuid', not_null: true },
      { name: 'content', type: 'jsonb', not_null: true },
      { name: 'status', type: 'text', not_null: true },
      { name: 'created_at', type: 'timestamp with time zone', not_null: true },
      { name: 'updated_at', type: 'timestamp with time zone', not_null: true },
    ]);

    const constraints = await pool.query(`
      SELECT c.contype AS type,
             ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                  ORDER BY k.ord) AS columns,
             CASE WHEN c.confrelid = 0 THEN NULL ELSE c.confrelid::regclass::text END AS referenced_table,
             ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
                  ORDER BY k.ord) AS referenced_columns,
             pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
       WHERE t.relnamespace = 'public'::regnamespace AND t.relname = 'kinesiology_evolutions'
       ORDER BY c.contype, columns`);
    const foreignKeys = constraints.rows.filter(({ type }) => type === 'f');
    assert.deepEqual(foreignKeys.map(({ columns: local, referenced_table, referenced_columns: remote }) => ({
      columns: local, referenced_table, referenced_columns: remote,
    })), [
      { columns: ['author_id'], referenced_table: 'users', referenced_columns: ['id'] },
      { columns: ['clinical_record_id', 'patient_id'], referenced_table: 'clinical_records', referenced_columns: ['id', 'patient_id'] },
      { columns: ['evaluation_id', 'clinical_record_id', 'patient_id'], referenced_table: 'kinesiology_evaluations', referenced_columns: ['id', 'clinical_record_id', 'patient_id'] },
      { columns: ['origin_group_id'], referenced_table: 'academic_groups', referenced_columns: ['id'] },
      { columns: ['origin_student_habilitation_id'], referenced_table: 'student_academic_habilitations', referenced_columns: ['id'] },
      { columns: ['origin_subject_id'], referenced_table: 'subjects', referenced_columns: ['id'] },
    ]);
    assert.ok(foreignKeys.every(({ definition }) => /ON DELETE RESTRICT$/.test(definition)));
    assert.ok(constraints.rows.some(({ type, definition }) => type === 'c' && /CHECK \(\(status = ANY \(ARRAY\['draft'::text, 'submitted'::text, 'validated'::text\]\)\)\)/.test(definition)));
  } finally {
    await pool.end();
  }
});
