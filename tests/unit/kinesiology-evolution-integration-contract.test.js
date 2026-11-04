import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../integration/kinesiology-evolution-schema.test.js', import.meta.url), 'utf8');

test('schema scenario proves the exact selected disposable target before a read-only pool is opened', () => {
  assert.match(source, /const selected = process\.env\.DISPOSABLE_INTEGRATION_TARGET === 'true'/);
  assert.match(source, /skip: selected \? false : 'requires explicit disposable integration target opt-in'/);
  assert.match(source, /verifyDisposableIntegrationTarget/);
  assert.ok(source.indexOf('await verifyDisposableIntegrationTarget') < source.indexOf('new pg\.Pool'));
  assert.match(source, /default_transaction_read_only=on/);
  assert.match(source, /finally[\s\S]*pool\.end\(\)/);
  assert.match(source, /pg_catalog\.(?:pg_attribute|pg_constraint)/);
  assert.match(source, /kinesiology_evolutions/);
  assert.match(source, /draft'::text, 'submitted'::text, 'validated'::text/);
  assert.doesNotMatch(source, /CHECK \(\(status = 'draft'::text\)\)/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP)\s+(?:INTO\s+)?(?:TABLE|INDEX|public\.)/i);
  assert.doesNotMatch(source, /\b(?:cleanDb|fixture|seed|\.skip\s*\(\s*false)/i);
});
