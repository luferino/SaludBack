import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../src/db/migrations/036_create_careers.sql', import.meta.url), 'utf8');

test('036 creates careers with unique codes, nonblank names, and exactly the two seeded careers', () => {
  assert.match(sql, /CREATE TABLE careers \(/);
  assert.match(sql, /id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  assert.match(sql, /code TEXT NOT NULL UNIQUE/);
  assert.match(sql, /name TEXT NOT NULL/);
  assert.match(sql, /CONSTRAINT careers_name_nonblank CHECK \(btrim\(name\) <> ''\)/);
  assert.match(sql, /INSERT INTO careers \(code, name\) VALUES\s+\('kinesiology', 'Kinesiología'\),\s+\('odontology', 'Odontología'\);/);
  assert.equal((sql.match(/\('(?:kinesiology|odontology)', '/g) ?? []).length, 2);
});

test('036 adds NOT NULL career_id to subjects and academic groups, backfilled to kinesiology before enforcement', () => {
  for (const table of ['subjects', 'academic_groups']) {
    const add = sql.indexOf(`ALTER TABLE ${table}\n  ADD COLUMN career_id UUID REFERENCES careers(id)`);
    const backfill = sql.indexOf(`UPDATE ${table} SET career_id = (SELECT id FROM careers WHERE code = 'kinesiology')`);
    const enforce = sql.indexOf(`ALTER TABLE ${table} ALTER COLUMN career_id SET NOT NULL`);
    assert.ok(add >= 0, `${table} career_id column is added`);
    assert.ok(backfill > add, `${table} backfill follows the column addition`);
    assert.ok(enforce > backfill, `${table} NOT NULL follows the backfill`);
  }
});

test('036 replaces the global academic group uniqueness with per-career uniqueness', () => {
  assert.match(sql, /ALTER TABLE academic_groups\s+DROP CONSTRAINT academic_groups_year_semester_name_unique;/);
  assert.match(
    sql,
    /ADD CONSTRAINT academic_groups_career_year_semester_name_unique\s+UNIQUE \(career_id, academic_year, curriculum_semester, name\)/,
  );
  assert.ok(sql.indexOf('DROP CONSTRAINT academic_groups_year_semester_name_unique') < sql.indexOf('academic_groups_career_year_semester_name_unique'));
});

test('036 makes subject-group career agreement database-enforced through composite keys backed by unique (id, career_id) targets', () => {
  const subjectTarget = sql.indexOf('CONSTRAINT subjects_id_career_unique UNIQUE (id, career_id)');
  const groupTarget = sql.indexOf('CONSTRAINT academic_groups_id_career_unique UNIQUE (id, career_id)');
  assert.ok(subjectTarget >= 0 && groupTarget >= 0, 'composite FK targets exist');
  assert.match(sql, /ALTER TABLE subject_academic_groups\s+ADD COLUMN career_id UUID/);
  assert.match(
    sql,
    /UPDATE subject_academic_groups AS sag SET career_id = s\.career_id FROM subjects AS s WHERE s\.id = sag\.subject_id/,
  );
  assert.match(sql, /ALTER TABLE subject_academic_groups ALTER COLUMN career_id SET NOT NULL/);
  assert.match(
    sql,
    /CONSTRAINT subject_academic_groups_subject_career_fkey\s+FOREIGN KEY \(subject_id, career_id\) REFERENCES subjects \(id, career_id\)/,
  );
  assert.match(
    sql,
    /CONSTRAINT subject_academic_groups_academic_group_career_fkey\s+FOREIGN KEY \(academic_group_id, career_id\) REFERENCES academic_groups \(id, career_id\)/,
  );
  assert.ok(subjectTarget < sql.indexOf('subject_academic_groups_subject_career_fkey'), 'subject target is created before the composite FK');
  assert.ok(groupTarget < sql.indexOf('subject_academic_groups_academic_group_career_fkey'), 'group target is created before the composite FK');
});

test('036 is schema and reference-data only: no permission seeds and no primary-key rewrite', () => {
  assert.doesNotMatch(sql, /permissions|role_permissions/);
  assert.doesNotMatch(sql, /subject_academic_groups_pkey/);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE/i);
});
