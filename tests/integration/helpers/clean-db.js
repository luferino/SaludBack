/**
 * FK-safe cleanup for the shared integration test DB (AUD-001 / PR 4 task 4.2).
 *
 * Deletes dependent habilitation, profile, catalog and clinical tables BEFORE
 * their parents and users, so no suite's beforeEach()/after() trips a FK
 * constraint on leftover rows. It first verifies the single column UPDATE privilege
 * needed to clear the correction FK cycle. The order below is the contract:
 * `clear correction_from_submission_id -> kinesiology_evaluation_correction_requests ->
 * kinesiology_evolution_correction_requests -> kinesiology_evolution_validation_reviews -> kinesiology_evolution_submissions ->
 * kinesiology_evaluation_validation_reviews -> kinesiology_evaluation_submission_studies -> kinesiology_evaluation_submissions ->
 * kinesiology_consent_attestations -> kinesiology_evaluation_amendment_links -> kinesiology_evolution_amendment_links ->
 * kinesiology_evolutions -> kinesiology_evaluations -> patient_assignments -> patient_context_availabilities ->
 * student_academic_habilitations -> teacher_academic_habilitations -> students -> teachers ->
 * subject_academic_groups -> academic_groups -> subjects -> clinical_records -> patients ->
 * password_reset_tokens -> users`. Every integration file runs this in per-test beforeEach() and after().
 *
 * After FK-safe deletes, TRUNCATE the permission-matrix tables
 * (role_permissions, permissions), then re-execute permission seeds 007,
 * 011–016, 018–019, 021, 027–028, 030, 032, 034, and 037 so every suite starts from the canonical permission state. Migrations 035 and 036 add no grants.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/007_seed_permission_matrix.sql'),
  'utf8',
);
const subjectPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/011_seed_subject_permissions.sql'),
  'utf8',
);
const groupPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/012_seed_group_permissions.sql'),
  'utf8',
);
const subjectGroupPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/013_seed_subject_group_permissions.sql'),
  'utf8',
);
const teacherHabilitationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/014_seed_teacher_habilitation_permissions.sql'),
  'utf8',
);
const teacherHabilitationRevocationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/015_seed_teacher_habilitation_revocation_permission.sql'),
  'utf8',
);
const studentHabilitationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/016_seed_student_habilitation_permissions.sql'),
  'utf8',
);
const studentHabilitationRevocationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/019_seed_student_habilitation_revocation_permission.sql'),
  'utf8',
);
const patientAssignmentPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/018_seed_patient_assignment_permissions.sql'),
  'utf8',
);
const kinesiologyEvaluationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/021_seed_kinesiology_evaluation_permissions.sql'),
  'utf8',
);

const profileReadPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/027_seed_profile_read_permissions.sql'),
  'utf8',
);
const habilitationReadPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/028_seed_habilitation_read_permissions.sql'),
  'utf8',
);
const patientAvailabilityPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/030_seed_patient_availability_permissions.sql'),
  'utf8',
);
const kinesiologyEvolutionPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/032_seed_kinesiology_evolution_permissions.sql'),
  'utf8',
);
const kinesiologyEvolutionReviewPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/034_seed_kinesiology_evolution_review_permissions.sql'),
  'utf8',
);
const careerPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/037_seed_career_permissions.sql'),
  'utf8',
);

const oralSurgerySubjectPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/039_seed_oral_surgery_subject_permissions.sql'), 'utf8',
);

const oralSurgeryDraftPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/041_seed_oral_surgery_draft_permissions.sql'), 'utf8',
);

const oralSurgeryAuthorizationPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/044_seed_oral_surgery_authorization_permission.sql'), 'utf8',
);

export async function cleanDb(pool) {
  const { rows } = await pool.query(
    "SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed",
  );
  if (rows[0]?.allowed !== true) {
    throw new Error('Database role lacks UPDATE privilege on public.kinesiology_evaluations.correction_from_submission_id required to clear correction links before cleanup');
  }
  await pool.query('UPDATE kinesiology_evaluations SET correction_from_submission_id = NULL WHERE correction_from_submission_id IS NOT NULL');
  await pool.query('DELETE FROM kinesiology_evolution_correction_requests');
  await pool.query('DELETE FROM kinesiology_evolution_validation_reviews');
  await pool.query('DELETE FROM kinesiology_evolution_submissions');
  await pool.query('DELETE FROM kinesiology_evaluation_correction_requests');
  await pool.query('DELETE FROM kinesiology_evaluation_validation_reviews');
  await pool.query('DELETE FROM kinesiology_evaluation_amendment_links');
  await pool.query('DELETE FROM kinesiology_evaluation_submission_studies');
  await pool.query('DELETE FROM kinesiology_evaluation_submissions');
  await pool.query('DELETE FROM kinesiology_consent_attestations');
  await pool.query('DELETE FROM kinesiology_evolution_amendment_links');
  await pool.query('DELETE FROM kinesiology_evolutions');
  await pool.query('DELETE FROM kinesiology_evaluations');
  await pool.query('DELETE FROM oral_surgery_authorizations');
  await pool.query('DELETE FROM oral_surgery_consent_declarations');
  await pool.query('DELETE FROM oral_surgery_drafts');
  await pool.query('DELETE FROM patient_assignments');
  await pool.query('DELETE FROM patient_context_availabilities');
  await pool.query('DELETE FROM student_academic_habilitations');
  await pool.query('DELETE FROM teacher_academic_habilitations');
  await pool.query('DELETE FROM students');
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM subject_academic_groups');
  await pool.query('DELETE FROM academic_groups');
  await pool.query('DELETE FROM oral_surgery_subjects');
  await pool.query('DELETE FROM subjects');
  await pool.query('DELETE FROM clinical_records');
  await pool.query('DELETE FROM patients');
  await pool.query('DELETE FROM password_reset_tokens');
  await pool.query('DELETE FROM users');
  // Re-seed the permission matrix so every suite starts from the canonical state.
  // TRUNCATE child first (role_permissions FK -> permissions), then parent.
  await pool.query('TRUNCATE role_permissions, permissions RESTART IDENTITY');
  await pool.query(seedSql);
  await pool.query(subjectPermissionSeedSql);
  await pool.query(groupPermissionSeedSql);
  await pool.query(subjectGroupPermissionSeedSql);
  await pool.query(teacherHabilitationPermissionSeedSql);
  await pool.query(teacherHabilitationRevocationPermissionSeedSql);
  await pool.query(studentHabilitationPermissionSeedSql);
  await pool.query(studentHabilitationRevocationPermissionSeedSql);
  await pool.query(patientAssignmentPermissionSeedSql);
  await pool.query(kinesiologyEvaluationPermissionSeedSql);
  await pool.query(profileReadPermissionSeedSql);
  await pool.query(habilitationReadPermissionSeedSql);
  await pool.query(patientAvailabilityPermissionSeedSql);
  await pool.query(kinesiologyEvolutionPermissionSeedSql);
  await pool.query(kinesiologyEvolutionReviewPermissionSeedSql);
  await pool.query(careerPermissionSeedSql);
  await pool.query(oralSurgerySubjectPermissionSeedSql);
  await pool.query(oralSurgeryDraftPermissionSeedSql);
  await pool.query(oralSurgeryAuthorizationPermissionSeedSql);
}