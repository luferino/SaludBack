import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanDb } from '../integration/helpers/clean-db.js';

const PROTECTED = [
  'kinesiology_consent_attestations', 'kinesiology_evaluation_submissions', 'kinesiology_evaluation_submission_studies',
  'kinesiology_evaluation_correction_requests', 'kinesiology_evaluation_validation_reviews', 'kinesiology_evaluation_amendment_links',
  'kinesiology_evolution_submissions', 'kinesiology_evolution_correction_requests', 'kinesiology_evolution_validation_reviews',
  'kinesiology_evolution_amendment_links', 'oral_surgery_consent_declarations', 'oral_surgery_authorizations',
  'oral_surgery_practical_evaluations',
];
const MUTABLE = ['kinesiology_evaluations', 'kinesiology_evolutions', 'oral_surgery_drafts', 'hygiene_preventive_drafts', 'oral_surgery_operative_reports', 'clinical_records'];
const TRUNCATE_CLOSURE = [...PROTECTED, 'kinesiology_evaluations', 'kinesiology_evolutions', 'oral_surgery_operative_reports'];

test('S1/S2: migration 053 rejects every DELETE statement on exactly the append-only clinical history tables', () => {
  const sql = readFileSync('src/db/migrations/053_guard_clinical_history_deletes.sql', 'utf8');
  assert.match(sql, /CREATE FUNCTION reject_clinical_history_delete\(\) RETURNS trigger/);
  assert.match(sql, /RAISE EXCEPTION 'clinical history rows cannot be deleted from %', TG_TABLE_NAME USING ERRCODE = '23514'/);
  const guarded = [...sql.matchAll(/CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON (\w+)\s+FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete\(\);/g)]
    .map(match => match[1]);
  assert.deepEqual([...guarded].sort(), [...PROTECTED].sort());
  for (const table of MUTABLE) assert.doesNotMatch(sql, new RegExp(`ON ${table}\\b`), table);
  assert.doesNotMatch(sql, /BEFORE TRUNCATE|FOR EACH ROW/);
});

test('S3: cleanDb truncates the guarded history closure in one statement and never DELETEs a guarded table', async () => {
  const calls = [];
  await cleanDb({ async query(text) {
    calls.push(text);
    return { rows: [] };
  } });
  const truncates = calls.filter(sql => sql.startsWith('TRUNCATE ') && !sql.includes('role_permissions'));
  assert.equal(truncates.length, 1);
  const truncated = truncates[0].replace(/^TRUNCATE /, '').split(',').map(name => name.trim());
  assert.deepEqual([...truncated].sort(), [...TRUNCATE_CLOSURE].sort());
  for (const table of TRUNCATE_CLOSURE) assert.equal(calls.includes(`DELETE FROM ${table}`), false, table);
  const truncateAt = calls.indexOf(truncates[0]);
  assert.equal(truncateAt, 0);
  assert.ok(truncateAt < calls.indexOf('DELETE FROM oral_surgery_drafts'));
  assert.ok(truncateAt < calls.indexOf('DELETE FROM patient_assignments'));
  assert.equal(calls.length, 47);
});
