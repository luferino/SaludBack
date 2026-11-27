/**
 * FK-safe cleanup for the shared integration test DB (AUD-001 / PR 4 task 4.2).
 *
 * Deletes dependent habilitation, profile, catalog and clinical tables BEFORE
 * their parents and users, so no suite's beforeEach()/after() trips a FK
 * constraint on leftover rows. The correction FK cycle (kinesiology_evaluations <->
 * kinesiology_evaluation_submissions) lies inside the truncated closure, so no link UPDATE is
 * needed. The order below is the contract:
 * `one TRUNCATE of the clinical history closure
 * (every kinesiology_* table plus oral_surgery_practical_evaluations, oral_surgery_operative_reports,
 * oral_surgery_authorizations and oral_surgery_consent_declarations; migration 053 rejects DELETE on the
 * append-only history tables, and TRUNCATE needs every table whose foreign keys reach them) ->
 * oral_surgery_drafts -> hygiene_preventive_procedures -> hygiene_preventive_consent_declarations -> hygiene_preventive_drafts -> endodontics_treatment_reports -> endodontics_drafts -> patient_assignments -> patient_context_availabilities ->
 * student_academic_habilitations -> teacher_academic_habilitations -> students -> teachers ->
 * subject_academic_groups -> academic_groups -> oral_surgery_subjects -> hygiene_preventive_subjects ->
 * subjects -> clinical_records -> patients ->
 * reception_patient_enrollments -> patients -> reception_career_grants -> password_reset_tokens -> users`. Every integration file runs this in per-test beforeEach() and after().
 *
 * After FK-safe deletes, TRUNCATE the permission-matrix tables
 * (role_permissions, permissions), then re-execute permission seeds 007,
 * 011–016, 018–019, 021, 027–028, 030, 032, 034, 037, 039, 041, 044, 050, 052, 055, 057, 059, 062–064, 066, 068, 070, and the permission/grant INSERT sections of 045–047 so every suite starts from the canonical permission state. Migrations 035 and 036 add no grants.
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
const oralSurgeryOperativeReportPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/050_seed_oral_surgery_operative_report_permissions.sql'), 'utf8',
);
const oralSurgeryGradePermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/052_seed_oral_surgery_grade_permission.sql'), 'utf8',
);
const hygienePreventiveSubjectPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/055_seed_hygiene_preventive_subject_permissions.sql'), 'utf8',
);
const endodonticsSubjectPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/066_seed_endodontics_subject_permissions.sql'), 'utf8',
);
const endodonticsDraftPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/068_seed_endodontics_draft_permissions.sql'), 'utf8',
);
const endodonticsTreatmentReportPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/070_seed_endodontics_treatment_report_permissions.sql'), 'utf8',
);
const hygienePreventiveDraftPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/057_seed_hygiene_preventive_draft_permissions.sql'), 'utf8',
);
const hygienePreventiveApprovalPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/059_seed_hygiene_preventive_procedure_approval_permission.sql'), 'utf8',
);
const patientPersonalDataPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/062_seed_patient_personal_data_permissions.sql'), 'utf8',
);
const assignmentReportPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/063_seed_assignment_report_permission.sql'), 'utf8',
);
const receptionAvailabilityReadPermissionSeedSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/064_seed_reception_availability_read_permission.sql'), 'utf8',
);
const receptionPermissionMigrationSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/045_create_reception_access.sql'), 'utf8',
);
const receptionPermissionSeedSql = receptionPermissionMigrationSql.match(/INSERT INTO permissions[\s\S]*/)?.[0];
if (!receptionPermissionSeedSql) throw new Error('Reception permission seed is missing from migration 045');
const receptionPatientPermissionMigrationSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/046_create_reception_patient_enrollments.sql'), 'utf8',
);
const receptionPatientPermissionSeedSql = receptionPatientPermissionMigrationSql.match(/INSERT INTO permissions[\s\S]*/)?.[0];
if (!receptionPatientPermissionSeedSql) throw new Error('Reception patient permission seed is missing from migration 046');
const receptionAvailabilityPermissionMigrationSql = readFileSync(
  join(__dirname, '../../../src/db/migrations/047_seed_reception_availability_permissions.sql'), 'utf8',
);
const receptionAvailabilityPermissionSeedSql = receptionAvailabilityPermissionMigrationSql.match(/INSERT INTO permissions[\s\S]*/)?.[0];
if (!receptionAvailabilityPermissionSeedSql) throw new Error('Reception availability permission seed is missing from migration 047');

export async function cleanDb(pool) {
  await pool.query('TRUNCATE kinesiology_evolution_correction_requests, kinesiology_evolution_validation_reviews, kinesiology_evolution_submissions, kinesiology_evaluation_correction_requests, kinesiology_evaluation_validation_reviews, kinesiology_evaluation_amendment_links, kinesiology_evaluation_submission_studies, kinesiology_evaluation_submissions, kinesiology_consent_attestations, kinesiology_evolution_amendment_links, kinesiology_evolutions, kinesiology_evaluations, oral_surgery_practical_evaluations, oral_surgery_operative_reports, oral_surgery_authorizations, oral_surgery_consent_declarations');
  await pool.query('DELETE FROM oral_surgery_drafts');
  await pool.query('TRUNCATE hygiene_preventive_procedures');
  await pool.query('TRUNCATE hygiene_preventive_consent_declarations');
  await pool.query('DELETE FROM hygiene_preventive_drafts');
  await pool.query('TRUNCATE endodontics_treatment_reports');
  await pool.query('DELETE FROM endodontics_drafts');
  await pool.query('DELETE FROM patient_assignments');
  await pool.query('DELETE FROM patient_context_availabilities');
  await pool.query('DELETE FROM student_academic_habilitations');
  await pool.query('DELETE FROM teacher_academic_habilitations');
  await pool.query('DELETE FROM students');
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM subject_academic_groups');
  await pool.query('DELETE FROM academic_groups');
  await pool.query('DELETE FROM oral_surgery_subjects');
  await pool.query('DELETE FROM hygiene_preventive_subjects');
  await pool.query('DELETE FROM endodontics_subjects');
  await pool.query('DELETE FROM subjects');
  await pool.query('DELETE FROM clinical_records');
  await pool.query('DELETE FROM reception_patient_enrollments');
  await pool.query('DELETE FROM patients');
  await pool.query('DELETE FROM reception_career_grants');
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
  await pool.query(oralSurgeryOperativeReportPermissionSeedSql);
  await pool.query(oralSurgeryGradePermissionSeedSql);
  await pool.query(hygienePreventiveSubjectPermissionSeedSql);
  await pool.query(hygienePreventiveDraftPermissionSeedSql);
  await pool.query(hygienePreventiveApprovalPermissionSeedSql);
  await pool.query(patientPersonalDataPermissionSeedSql);
  await pool.query(assignmentReportPermissionSeedSql);
  await pool.query(receptionPermissionSeedSql);
  await pool.query(receptionPatientPermissionSeedSql);
  await pool.query(receptionAvailabilityPermissionSeedSql);
  await pool.query(receptionAvailabilityReadPermissionSeedSql);
  await pool.query(endodonticsSubjectPermissionSeedSql);
  await pool.query(endodonticsDraftPermissionSeedSql);
  await pool.query(endodonticsTreatmentReportPermissionSeedSql);
}