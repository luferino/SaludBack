import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REQUIRED_EMPTY_BASELINE_TABLES } from '../helpers/disposable-integration-target.js';

const root = process.cwd();
const suitePath = path.join(root, 'tests/integration/kinesiology-evolutions.test.js');
const source = readFileSync(suitePath, 'utf8');

test('evolution integration suite is opt-in only and verifies its generated target before opening a pool', () => {
  assert.match(source, /const selected = process\.env\.DISPOSABLE_INTEGRATION_TARGET === 'true'/);
  assert.match(source, /\{ skip: !selected/);
  assert.doesNotMatch(source, /\.env\.test|readFileSync/);
  assert.doesNotMatch(source, /DATABASE_URL\s*=\s*process\.env\.DATABASE_URL/);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]+\s*(?:\?\?=|(?<![=!<>])=(?!=))|delete process\.env/i,
    'suite does not inject or erase connection/auth override variables');
  assert.match(source, /assert\.equal\(process\.env\.DATABASE_URL, process\.env\.DISPOSABLE_INTEGRATION_DATABASE_URL/);
  assert.match(source, /const options = '[^']+';[\s\S]*pool = new pg\.Pool\([\s\S]*options\s*\}\);/,
    'connection search path and timeouts stay on the pool, not in inherited environment');
  assert.match(source, /before\(async \(\) => \{[\s\S]*?\}, \{ timeout: 30000 \}\);/,
    'Node before hook receives its callback first and keeps the 30-second timeout as its second argument');
  assert.match(source, /after\(async \(\) => \{[\s\S]*?\}, \{ timeout: 30000 \}\);/,
    'Node after hook receives its callback first and keeps the 30-second timeout as its second argument');
  assert.ok(source.indexOf('await verifyDisposableIntegrationTarget()') < source.indexOf('new pg.Pool('),
    'read-only generated identity and complete empty baseline check must precede fixture connections');
  assert.ok(source.indexOf('await cleanDb(pool)') > source.indexOf('await verifyDisposableIntegrationTarget()'),
    'shared FK-safe cleanup must follow a successful target guard');
  assert.match(source, /await cleanDb\(pool\);[\s\S]*await verifyDisposableIntegrationTarget\(\)/,
    'suite teardown cleans rows and verifies the empty baseline again');
  assert.match(source, /cleanDb\(pool\)/);
  assert.doesNotMatch(source, /\b(?:CREATE|DROP)\s+DATABASE\b/i);
  assert.doesNotMatch(source, /\b(?:TRUNCATE|DELETE\s+FROM)\b/i);
  assert.match(source, /SET revoked_by=\$2,revoked_at=clock_timestamp\(\)/);
  assert.match(source, /SET ended_by=\$2,ended_at=clock_timestamp\(\)/);
  assert.doesNotMatch(source, /SET revoked_at=NULL|SET ended_at=NULL/i,
    'history is renewed with new period rows rather than un-revoking history');
  assert.match(source, /assert\.equal\(second\.body\.ordinal, '2'\)/);
  assert.match(source, /assert\.equal\(third\.body\.ordinal, '3'\)/);
  assert.match(source, /await publicState\(studentJwt, f\.patient, \[draft\.body\.id\]\)[\s\S]*await publicState\(studentJwt, f\.patient, \[draft\.body\.id\]\)/);
  assert.match(source, /await fkConstraintName\(probe[\s\S]*await checkConstraintName\(probe/);
  assert.match(source, /assert\.equal\(observed\.constraint, constraint\)/);
  assert.match(source, /array_agg\(sa\.attname::text ORDER BY sk\.ordinality\)/);
  assert.match(source, /array_agg\(ta\.attname::text ORDER BY tk\.ordinality\)/);
  assert.doesNotMatch(source, /constraint\.startsWith|assert\.match\(error\.constraint/,
    'live SQL assertions resolve exact catalog constraint names rather than guess generated names');
  assert.doesNotMatch(source, /documents:\s*1/,
    'public rejection checks do not assume the suite has only one fixture document');
  assert.match(source, /if \(transactionStarted\)[\s\S]*await probe\.query\('ROLLBACK'\)[\s\S]*probe\.release\(\)/);
  assert.match(source, /teacherDetailDuringCorrection[\s\S]*teacherHistoryDuringCorrection/);
  assert.match(source, /corrections`, otherTeacherJwt\)\)\.status, 404/);
  assert.match(source, /crossContextDetailDuringCorrection\.body\.updated_at, second\.body\.submitted_at/);
  assert.match(source, /crossContextHistoryDuringCorrection\.body\.items\[0\]\.id, second\.body\.id/);
  assert.match(source, /never-submitted amendment is hidden/);
  assert.match(source, /replacementAmendment\.body\.author_id, f\.otherStudent\.id/);
});

test('catalog column aggregates use driver-decoded text arrays instead of raw name arrays', async () => {
  const { default: pg } = await import('pg');
  const columns = ['evaluation_id', 'clinical_record_id', 'patient_id'];
  const encoded = `{${columns.join(',')}}`;
  assert.equal(typeof pg.types.getTypeParser(1003)(encoded), 'string',
    'PostgreSQL name[] is not decoded as a JavaScript array by the driver');
  assert.deepEqual(pg.types.getTypeParser(1009)(encoded), columns,
    'PostgreSQL text[] is decoded as the ordered column array expected by the FK lookup');
  assert.match(source, /array_agg\(sa\.attname::text ORDER BY sk\.ordinality\)/);
  assert.match(source, /array_agg\(ta\.attname::text ORDER BY tk\.ordinality\)/);
});

test('empty baseline coverage is coupled to the live verifier ledger rather than a guessed table count', () => {
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolutions'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_submissions'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_validation_reviews'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_correction_requests'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_amendment_links'));
  assert.equal(new Set(REQUIRED_EMPTY_BASELINE_TABLES).size, REQUIRED_EMPTY_BASELINE_TABLES.length,
    'the verifier-derived baseline list contains no duplicate tables');
});
