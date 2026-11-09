import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb checks correction-link column privilege and clears cyclic links before child rows', async () => {
  const calls = [];
  await cleanDb({ async query(text) {
    calls.push(text);
    return text.includes('has_column_privilege') ? { rows: [{ allowed: true }] } : { rows: [] };
  } });
  assert.equal(calls[0], "SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed");
  assert.equal(calls[1], 'UPDATE kinesiology_evaluations SET correction_from_submission_id = NULL WHERE correction_from_submission_id IS NOT NULL');
  assert.deepEqual(calls.slice(2, 33), [
    'DELETE FROM kinesiology_evolution_correction_requests',
    'DELETE FROM kinesiology_evolution_validation_reviews',
    'DELETE FROM kinesiology_evolution_submissions',
    'DELETE FROM kinesiology_evaluation_correction_requests',
    'DELETE FROM kinesiology_evaluation_validation_reviews',
    'DELETE FROM kinesiology_evaluation_amendment_links',
    'DELETE FROM kinesiology_evaluation_submission_studies',
    'DELETE FROM kinesiology_evaluation_submissions',
    'DELETE FROM kinesiology_consent_attestations',
    'DELETE FROM kinesiology_evolution_amendment_links',
    'DELETE FROM kinesiology_evolutions',
    'DELETE FROM kinesiology_evaluations',
    'DELETE FROM oral_surgery_authorizations',
    'DELETE FROM oral_surgery_consent_declarations',
    'DELETE FROM oral_surgery_drafts',
    'DELETE FROM patient_assignments',
    'DELETE FROM patient_context_availabilities',
    'DELETE FROM student_academic_habilitations',
    'DELETE FROM teacher_academic_habilitations',
    'DELETE FROM students',
    'DELETE FROM teachers',
    'DELETE FROM subject_academic_groups',
    'DELETE FROM academic_groups',
    'DELETE FROM oral_surgery_subjects',
    'DELETE FROM subjects',
    'DELETE FROM clinical_records',
    'DELETE FROM reception_patient_enrollments',
    'DELETE FROM patients',
    'DELETE FROM reception_career_grants',
    'DELETE FROM password_reset_tokens',
    'DELETE FROM users',
  ]);
  assert.equal(calls[33], 'TRUNCATE role_permissions, permissions RESTART IDENTITY');
  assert.match(calls[34], /INSERT INTO permissions[\s\S]*materias:read/);
  assert.match(calls[35], /subjects:write[\s\S]*subjects:read/);
  assert.match(calls[36], /groups:write[\s\S]*groups:read/);
  assert.match(calls[37], /subject-groups:write[\s\S]*subject-groups:read/);
  assert.match(calls[38], /teacher-habilitations:write/);
  assert.match(calls[39], /teacher-habilitations:revoke/);
  assert.match(calls[40], /student-habilitations:write/);
  assert.match(calls[41], /student-habilitations:revoke/);
  assert.match(calls[42], /patient-assignments:write[\s\S]*patient-assignments:read-own/);
  assert.match(calls[43], /kinesiology-evaluations:read[\s\S]*kinesiology-evaluations:review/);
  assert.match(calls[44], /teachers:read[\s\S]*students:read/);
  assert.match(calls[45], /teacher-habilitations:read[\s\S]*student-habilitations:read/);
  assert.match(calls[46], /patient-availabilities:manage[\s\S]*patient-availabilities:read/);
  assert.match(calls[47], /kinesiology-evolutions:write[\s\S]*kinesiology-evolutions:read/);
  assert.match(calls[48], /kinesiology-evolutions:submit[\s\S]*kinesiology-evolutions:review/);
  assert.match(calls[49], /INSERT INTO permissions \(permission, enforced\) VALUES\s+\('careers:read', true\)/);
  assert.match(calls[50], /oral-surgery-subjects:read[\s\S]*oral-surgery-subjects:write/);
  assert.match(calls[51], /oral-surgery-drafts:read[\s\S]*oral-surgery-drafts:write/);
  assert.match(calls[52], /oral-surgery-drafts:authorize/);
  assert.match(calls[53], /INSERT INTO permissions[\s\S]*reception:accounts:write[\s\S]*reception:careers:write[\s\S]*reception:careers:read/);
  assert.match(calls[53], /\('reception', 'profile:read'\)/);
  assert.match(calls[53], /\('reception', 'reception:careers:read'\)/);
  assert.doesNotMatch(calls[53], /CREATE TABLE|CREATE (?:UNIQUE )?INDEX/);
  assert.match(calls[54], /INSERT INTO permissions[\s\S]*reception:patients:manage/);
  assert.match(calls[54], /\('reception', 'reception:patients:manage'\)/);
  assert.doesNotMatch(calls[54], /CREATE TABLE|CREATE (?:UNIQUE )?INDEX/);
  assert.match(calls[55], /INSERT INTO permissions[\s\S]*reception:availability:manage/);
  assert.match(calls[55], /\('reception', 'reception:availability:manage'\)/);
  assert.doesNotMatch(calls[55], /CREATE TABLE|CREATE (?:UNIQUE )?INDEX/);
  assert.equal(calls.length, 56);
});

test('cleanDb fails closed on missing correction-link UPDATE privilege before any cleanup mutation', async () => {
  const calls = [];
  await assert.rejects(cleanDb({ async query(text) {
    calls.push(text);
    return { rows: [{ allowed: false }] };
  } }), /UPDATE privilege on public\.kinesiology_evaluations\.correction_from_submission_id/);
  assert.deepEqual(calls, ["SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed"]);
  assert.equal(calls.some(sql => /^(UPDATE|DELETE|TRUNCATE)\b|INSERT INTO/.test(sql)), false);
});
