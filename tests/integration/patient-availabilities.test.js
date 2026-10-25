import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PgUnitOfWork } from '../../src/modules/shared/infrastructure/pg-unit-of-work.ts';
import { PgPatientAvailabilityRepository } from '../../src/modules/patient-availabilities/index.ts';

// Opt-in only: no .env discovery and no test DB is opened without an explicit
// disposable loopback URL plus pre-created UUID fixture values. This source is
// not part of the database-free runner and was not executed for T1.
const url = process.env.PATIENT_AVAILABILITY_DISPOSABLE_DATABASE_URL;
const fixture = {
  patientId: process.env.PATIENT_AVAILABILITY_FIXTURE_PATIENT_ID,
  subjectId: process.env.PATIENT_AVAILABILITY_FIXTURE_SUBJECT_ID,
  groupId: process.env.PATIENT_AVAILABILITY_FIXTURE_GROUP_ID,
  actorId: process.env.PATIENT_AVAILABILITY_FIXTURE_ACTOR_ID,
};
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

test('Opt-in PostgreSQL disposable-target preflight only (no concurrency assertions)', { skip: !url }, async () => {
  assert.ok(Object.values(fixture).every(uuid), 'explicit pre-created fixture UUIDs are required');
  const target = new URL(url);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && target.username && target.password);
  assert.equal(target.hostname, 'localhost'); assert.equal(target.port, '5432'); assert.match(target.pathname, /_test$/);
  const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000, options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000' });
  try {
    const { rows } = await pool.query("SELECT current_database() AS name, current_setting('transaction_read_only') AS read_only");
    assert.equal(rows[0].name, decodeURIComponent(target.pathname.slice(1))); assert.equal(rows[0].read_only, 'on');
    const { rows: migrations } = await pool.query("SELECT name FROM schema_migrations WHERE name IN ('029_create_patient_context_availabilities.sql','030_seed_patient_availability_permissions.sql')");
    assert.equal(migrations.length, 2);
    // A real concurrency run requires write access to explicitly disposable DB
    // state. This read-only preflight deliberately stops before mutation; race
    // behavior is covered with fake PgUnitOfWork tests, not claimed as proven.
  } finally { await pool.end(); }
});
