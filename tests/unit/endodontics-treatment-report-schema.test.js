import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const migrations = readdirSync('src/db/migrations').filter(name => /^\d+_.*\.sql$/.test(name)).sort();
const read = (name) => readFileSync(`src/db/migrations/${name}`, 'utf8');
const schema = () => read(migrations.find(name => name.startsWith('069_')));
const seed = () => read(migrations.find(name => name.startsWith('070_')));

test('S2/S3 ledger: treatment report schema is numbered 069 and its permission seed 070 directly after the draft migrations', () => {
  assert.equal(migrations.at(-3), '068_seed_endodontics_draft_permissions.sql');
  assert.equal(migrations.at(-2), '069_create_endodontics_treatment_reports.sql');
  assert.equal(migrations.at(-1), '070_seed_endodontics_treatment_report_permissions.sql');
  assert.equal(migrations.length, 70);
});

test('S2: exactly one report per draft through a UNIQUE, restrictive link to the diagnostic draft', () => {
  const sql = schema();
  assert.match(sql, /CREATE TABLE endodontics_treatment_reports/);
  assert.match(sql, /draft_id BIGINT NOT NULL UNIQUE REFERENCES endodontics_drafts\(id\) ON DELETE RESTRICT/);
});

test('S3: content is a JSON object, status is draft|closed, version is positive, and closure audit is all-or-nothing', () => {
  const sql = schema();
  assert.match(sql, /content JSONB NOT NULL DEFAULT '\{\}'::jsonb CHECK \(jsonb_typeof\(content\) = 'object'\)/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'closed'\)\)/);
  assert.match(sql, /version BIGINT NOT NULL DEFAULT 1 CHECK \(version > 0\)/);
  assert.match(sql, /created_by UUID NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /closed_by UUID REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /teacher_habilitation_id UUID REFERENCES teacher_academic_habilitations\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CONSTRAINT endodontics_treatment_report_close_audit CHECK \(/);
  assert.match(sql, /\(status = 'draft' AND closed_by IS NULL AND closed_at IS NULL AND teacher_habilitation_id IS NULL\)/);
  assert.match(sql, /\(status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND teacher_habilitation_id IS NOT NULL\)/);
});

test('S3: a closed report is immutable and cannot be deleted, and its draft link, author, and creation time never change', () => {
  const sql = schema();
  assert.match(sql, /CREATE TRIGGER endodontics_treatment_report_immutable\s+BEFORE UPDATE ON endodontics_treatment_reports/);
  assert.match(sql, /IF OLD\.status = 'closed'/);
  assert.match(sql, /ROW\(NEW\.id, NEW\.draft_id, NEW\.created_by, NEW\.created_at, NEW\.version\)/);
  assert.match(sql, /IS DISTINCT FROM ROW\(OLD\.id, OLD\.draft_id, OLD\.created_by, OLD\.created_at, OLD\.version \+ 1\)/);
  assert.match(sql, /CREATE TRIGGER endodontics_treatment_report_undeletable\s+BEFORE DELETE ON endodontics_treatment_reports/);
  assert.match(sql, /IF OLD\.status = 'closed' THEN[\s\S]*RAISE EXCEPTION/);
});

test('S3: closing may only set the audit fields and must not change content; drafts stay open to edits without a closed report', () => {
  const sql = schema();
  assert.match(sql, /OLD\.status = 'draft' AND NEW\.status = 'closed'/);
  assert.match(sql, /NEW\.content IS DISTINCT FROM OLD\.content/);
  assert.match(sql, /NEW\.closed_by IS NULL OR NEW\.closed_at IS NULL OR NEW\.teacher_habilitation_id IS NULL/);
  assert.match(sql, /NEW\.updated_at <= OLD\.updated_at/);
});

test('S3: the diagnostic draft content and version are locked by a closed report and every rejection uses SQLSTATE 23514', () => {
  const sql = schema();
  assert.match(sql, /CREATE FUNCTION protect_closed_endodontics_treatment_draft\(\)/);
  assert.match(sql, /CREATE TRIGGER endodontics_closed_treatment_draft_immutable\s+BEFORE UPDATE ON endodontics_drafts/);
  assert.match(sql, /ROW\(NEW\.content, NEW\.version\) IS DISTINCT FROM ROW\(OLD\.content, OLD\.version\)/);
  assert.match(sql, /r\.draft_id = OLD\.id AND r\.status = 'closed'/);
  assert.equal((sql.match(/ERRCODE = '23514'/g) ?? []).length, 6);
});

test('S3: migration 069 does not alter the existing draft origin guard', () => {
  const origin = read('067_create_endodontics_drafts.sql');
  assert.match(origin, /CREATE TRIGGER endodontics_draft_origin_immutable BEFORE UPDATE ON endodontics_drafts/);
  assert.doesNotMatch(schema(), /DROP TRIGGER endodontics_draft_origin_immutable|DROP FUNCTION preserve_endodontics_draft_origin/);
});

test('S3: the close permission is a new permission granted to teachers only; no student or admin close grant is seeded', () => {
  const sql = seed();
  assert.match(sql, /INSERT INTO permissions \(permission, enforced\) VALUES\s*\('endodontics-treatment-reports:close', true\)/);
  assert.match(sql, /INSERT INTO role_permissions \(role, permission\) VALUES\s*\('teacher', 'endodontics-treatment-reports:close'\)/);
  assert.doesNotMatch(sql, /'estudiante', 'endodontics-treatment-reports/);
  assert.doesNotMatch(sql, /'admin', 'endodontics-treatment-reports/);
  assert.equal((sql.match(/'endodontics-treatment-reports:/g) ?? []).length, 2);
});

test('S2/S3 access reuse: writes and reads go through the existing draft permissions, not a second permission family', () => {
  const sql = seed();
  assert.doesNotMatch(sql, /endodontics-treatment-reports:(read|write)/);
  assert.match(read('068_seed_endodontics_draft_permissions.sql'), /endodontics-drafts:write/);
});

test('F3 inventory: integration cleanup, required-table and empty-baseline lists name endodontics_treatment_reports', () => {
  for (const file of ['tests/integration/groups.test.js', 'tests/integration/subject-groups.test.js']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /const CLEANUP_TABLES = \[[\s\S]*?'endodontics_treatment_reports'[\s\S]*?\];/, `${file} CLEANUP_TABLES`);
    // Reports are cleaned by TRUNCATE (a closed report cannot be DELETEd), so they belong to the truncate-only group.
    assert.match(source, /const HISTORY_ORAL_SURGERY_TABLES = \[[^\]]*'endodontics_treatment_reports'/, `${file} truncate-only group`);
  }
  assert.match(readFileSync('tests/integration/student-habilitations.test.js', 'utf8'),
    /const REQUIRED_TABLES = \[[\s\S]*?'endodontics_treatment_reports'[\s\S]*?\];/);
  const drafts = readFileSync('tests/integration/kinesiology-evaluation-drafts.test.js', 'utf8');
  assert.match(drafts, /\(SELECT count\(\*\)::int FROM endodontics_treatment_reports\) endodontics_treatment_reports/);
  assert.match(drafts, /endodontics_treatment_reports:0/);
});

test('F2/cap docs: close body carries expected_draft_version, and the canal bound is 64 and documented as technical', () => {
  const docs = readFileSync('docs/endodontics.md', 'utf8');
  assert.match(docs, /\{ "expected_version": "2", "expected_draft_version": "\d+" \}/);
  assert.match(docs, /requires `expected_version` and `expected_draft_version`/);
  assert.match(docs, /64-row bound/);
  assert.doesNotMatch(docs, /32-row/);
});
