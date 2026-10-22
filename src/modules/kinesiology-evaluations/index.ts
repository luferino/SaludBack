import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { PermissionGuard } from '../shared/application/guard.js';
import type { Guard } from '../shared/application/guard.js';
import type { Queryable, UnitOfWorkPort } from '../shared/application/unit-of-work.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../shared/domain/errors.js';
import { defaultGetActor } from '../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../subject-groups/application/create-subject-group.usecase.js';

export interface EvaluationContent {
  admission_date?: string | null;
  admission_status?: string | null;
  illness_history?: string | null;
  medical_diagnosis?: string | null;
  kinesiology_diagnosis?: string | null;
  objectives?: string | null;
  proposed_treatment?: string | null;
  occupation?: string | null;
  referring_physician?: string | null;
  antecedents?: {
    hta?: boolean | null;
    dbt?: boolean | null;
    diu?: boolean | null;
    sedentary_lifestyle?: boolean | null;
    pacemaker?: boolean | null;
    other?: string | null;
  };
  studies?: Array<{ type: string; description: string; date?: string | null }>;
}

interface PatientDemographics {
  id: string;
  documento: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: Date | string;
  email: string;
  celular: string;
  sexo: string;
  direccion: string;
}

interface EvaluationRow {
  id: string;
  patient?: PatientDemographics;
  clinical_record_id: string;
  patient_id: string;
  author_id: string;
  origin_student_habilitation_id: string;
  origin_subject_id: string;
  origin_group_id: string;
  content: EvaluationContent;
  created_at: Date | string;
  updated_at: Date | string;
  status?: 'draft' | 'submitted' | 'validated';
}

interface EvaluationReadRow extends EvaluationRow {
  projected_submission_id?: string | null;
  projected_submission_ordinal?: string | null;
  projected_submitted_by?: string | null;
  projected_submitted_at?: Date | string | null;
  projected_age_at_admission?: number | null;
  projected_consent?: Record<string, unknown> | null;
  patient_documento: string;
  patient_nombres: string;
  patient_apellidos: string;
  patient_fecha_nacimiento: Date | string;
  patient_email: string;
  patient_celular: string;
  patient_sexo: string;
  patient_direccion: string;
}

interface Context {
  subjectId: string;
  groupId: string;
}

const MAX_BIGINT = 9223372036854775807n;
const EVALUATION_COLUMNS = `e.id::text AS id, e.clinical_record_id::text AS clinical_record_id,
  e.patient_id, e.author_id, e.origin_student_habilitation_id, e.origin_subject_id,
  e.origin_group_id, e.content, e.created_at, e.updated_at, e.status`;

function originRead(actor: string): string {
  return `((e.author_id = ${actor} AND EXISTS (
    SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
    JOIN patient_assignments a ON a.student_habilitation_id = sp.id
    WHERE s.user_id = ${actor} AND a.patient_id = e.patient_id
      AND sp.subject_id = e.origin_subject_id AND sp.academic_group_id = e.origin_group_id
      AND sp.revoked_at IS NULL AND a.ended_at IS NULL
  )) OR EXISTS (
    SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
    WHERE t.user_id = ${actor} AND th.subject_id = e.origin_subject_id
      AND th.academic_group_id = e.origin_group_id AND th.revoked_at IS NULL
  ))`;
}

function crossContextRead(actor: string): string {
  return `(EXISTS (
    SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
    JOIN patient_assignments a ON a.student_habilitation_id = sp.id
    WHERE s.user_id = ${actor} AND a.patient_id = e.patient_id
      AND a.subject_id = sp.subject_id AND sp.revoked_at IS NULL AND a.ended_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
    JOIN patient_assignments a ON a.patient_id = e.patient_id AND a.subject_id = th.subject_id AND a.ended_at IS NULL
    JOIN student_academic_habilitations sp ON sp.id = a.student_habilitation_id
      AND sp.subject_id = th.subject_id AND sp.academic_group_id = th.academic_group_id AND sp.revoked_at IS NULL
    WHERE t.user_id = ${actor} AND th.revoked_at IS NULL
  ))`;
}

function projectedReadColumns(origin: string): string {
  return `e.id::text AS id, e.clinical_record_id::text AS clinical_record_id, e.patient_id,
    e.author_id, e.origin_student_habilitation_id, e.origin_subject_id, e.origin_group_id,
    CASE WHEN ${origin} THEN e.content ELSE snapshot.clinical_content END AS content,
    CASE WHEN ${origin} THEN e.created_at ELSE snapshot.submitted_at END AS created_at,
    CASE WHEN ${origin} THEN e.updated_at ELSE snapshot.submitted_at END AS updated_at,
    CASE WHEN ${origin} THEN e.status WHEN validation.id IS NOT NULL THEN 'validated' ELSE 'submitted' END AS status,
    CASE WHEN ${origin} THEN NULL ELSE snapshot.id::text END AS projected_submission_id,
    CASE WHEN ${origin} THEN NULL ELSE snapshot.ordinal::text END AS projected_submission_ordinal,
    CASE WHEN ${origin} THEN NULL ELSE snapshot.submitted_by::text END AS projected_submitted_by,
    CASE WHEN ${origin} THEN NULL ELSE snapshot.submitted_at END AS projected_submitted_at,
    CASE WHEN ${origin} THEN NULL ELSE snapshot.age_at_admission END AS projected_age_at_admission,
    CASE WHEN ${origin} THEN NULL ELSE snapshot.verified_consent_snapshot END AS projected_consent,
    CASE WHEN ${origin} THEN p.documento ELSE snapshot.patient_snapshot->>'documento' END AS patient_documento,
    CASE WHEN ${origin} THEN p.nombres ELSE snapshot.patient_snapshot->>'nombres' END AS patient_nombres,
    CASE WHEN ${origin} THEN p.apellidos ELSE snapshot.patient_snapshot->>'apellidos' END AS patient_apellidos,
    CASE WHEN ${origin} THEN p.fecha_nacimiento::text ELSE snapshot.patient_snapshot->>'fecha_nacimiento' END AS patient_fecha_nacimiento,
    CASE WHEN ${origin} THEN p.email ELSE snapshot.patient_snapshot->>'email' END AS patient_email,
    CASE WHEN ${origin} THEN p.celular ELSE snapshot.patient_snapshot->>'celular' END AS patient_celular,
    CASE WHEN ${origin} THEN p.sexo ELSE snapshot.patient_snapshot->>'sexo' END AS patient_sexo,
    CASE WHEN ${origin} THEN p.direccion ELSE snapshot.patient_snapshot->>'direccion' END AS patient_direccion`;
}

function evaluationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new BadRequestError('evaluation id must be a positive BIGINT decimal string');
  }
  return value;
}

function requireUuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) throw new BadRequestError(`${field} must be an object`);
  return value;
}

function validateDate(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`${field} must be a valid YYYY-MM-DD date or null`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestError(`${field} must be a valid YYYY-MM-DD date or null`);
  }
  return value;
}

function validateContent(value: unknown): EvaluationContent {
  const input = requireObject(value, 'content');
  const textFields = [
    'admission_status', 'illness_history', 'medical_diagnosis', 'kinesiology_diagnosis',
    'objectives', 'proposed_treatment', 'occupation', 'referring_physician',
  ];
  const allowed = new Set([...textFields, 'admission_date', 'antecedents', 'studies']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new BadRequestError(`unknown content field: ${key}`);
  }
  const output: Record<string, unknown> = {};
  for (const key of textFields) {
    if (!Object.hasOwn(input, key)) continue;
    const field = input[key];
    if (field !== null && typeof field !== 'string') throw new BadRequestError(`${key} must be a string or null`);
    output[key] = field;
  }
  if (Object.hasOwn(input, 'admission_date')) output.admission_date = validateDate(input.admission_date, 'admission_date');

  if (Object.hasOwn(input, 'antecedents')) {
    const antecedents = requireObject(input.antecedents, 'antecedents');
    const names = ['hta', 'dbt', 'diu', 'sedentary_lifestyle', 'pacemaker', 'other'];
    for (const name of Object.keys(antecedents)) {
      if (!names.includes(name)) throw new BadRequestError(`unknown antecedent: ${name}`);
    }
    const typed: Record<string, unknown> = {};
    for (const name of names) {
      if (!Object.hasOwn(antecedents, name)) continue;
      const field = antecedents[name];
      if (name === 'other') {
        if (field !== null && typeof field !== 'string') throw new BadRequestError('antecedents.other must be a string or null');
      } else if (field !== null && typeof field !== 'boolean') {
        throw new BadRequestError(`antecedents.${name} must be a boolean or null`);
      }
      typed[name] = field;
    }
    output.antecedents = typed;
  }

  if (Object.hasOwn(input, 'studies')) {
    if (!Array.isArray(input.studies)) throw new BadRequestError('studies must be an array');
    output.studies = input.studies.map((study, index) => {
      const item = requireObject(study, `studies[${index}]`);
      if (Object.keys(item).some(key => !['type', 'description', 'date'].includes(key))) {
        throw new BadRequestError(`studies[${index}] has unknown fields`);
      }
      if (typeof item.type !== 'string' || !item.type.trim()) throw new BadRequestError(`studies[${index}].type must be a non-empty string`);
      if (typeof item.description !== 'string' || !item.description.trim()) throw new BadRequestError(`studies[${index}].description must be a non-empty string`);
      const date = Object.hasOwn(item, 'date') ? validateDate(item.date, `studies[${index}].date`) : undefined;
      return { type: item.type, description: item.description, ...(date === undefined ? {} : { date }) };
    });
  }
  return output as EvaluationContent;
}

function verifiedActor(getActor: (request: Request) => Promise<string | null>, request: Request): Promise<string> {
  return getActor(request).then(actor => {
    if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required');
    return actor;
  });
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function ageAtAdmission(birthDate: Date | string, admissionDate?: string | null): number | null {
  if (!admissionDate) return null;
  const birth = new Date(`${dateOnly(birthDate)}T00:00:00Z`);
  const admission = new Date(`${admissionDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(admission.getTime())) return null;
  let age = admission.getUTCFullYear() - birth.getUTCFullYear();
  if (admission.getUTCMonth() < birth.getUTCMonth() ||
    (admission.getUTCMonth() === birth.getUTCMonth() && admission.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

function serialize(row: EvaluationRow) {
  const patient = row.patient;
  const projected = row as EvaluationReadRow;
  return {
    id: row.id,
    clinical_record_id: row.clinical_record_id,
    patient_id: row.patient_id,
    author_id: row.author_id,
    origin_student_habilitation_id: row.origin_student_habilitation_id,
    origin_subject_id: row.origin_subject_id,
    origin_group_id: row.origin_group_id,
    status: row.status ?? 'draft',
    ...(row.status === 'submitted' || row.status === 'validated' ? { validation_status: row.status === 'validated' ? 'validated' : 'pending_validation' } : {}),
    content: row.content,
    patient: patient ? {
      id: patient.id, documento: patient.documento, nombres: patient.nombres,
      apellidos: patient.apellidos, fecha_nacimiento: dateOnly(patient.fecha_nacimiento),
      email: patient.email, celular: patient.celular, sexo: patient.sexo, direccion: patient.direccion,
    } : null,
    age: projected.projected_submission_id
      ? projected.projected_age_at_admission ?? null
      : patient ? ageAtAdmission(patient.fecha_nacimiento, row.content.admission_date) : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    ...(projected.projected_submission_id ? {
      submission_id: projected.projected_submission_id,
      submission_ordinal: projected.projected_submission_ordinal,
      submitted_by: projected.projected_submitted_by,
      submitted_at: projected.projected_submitted_at && new Date(projected.projected_submitted_at).toISOString(),
      consent: projected.projected_consent,
    } : {}),
  };
}

export class PgKinesiologyEvaluationRepository {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  async create(patientId: string, context: Context, content: EvaluationContent, actorId: string): Promise<EvaluationRow> {
    return this.unitOfWork.withTransaction(async db => {
      const student = await db.query<{ id: string }>(
        'SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [actorId],
      );
      if (!student.rows.length) throw new ForbiddenError('an active student context is required');

      const periods = await db.query<{ id: string }>(
        `SELECT id FROM student_academic_habilitations
          WHERE student_id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
          ORDER BY id FOR UPDATE`,
        [student.rows[0].id, context.subjectId, context.groupId],
      );
      if (!periods.rows.length) throw new ForbiddenError('an active student context is required');

      // Check context before looking up the patient, preventing patient-existence disclosure.
      const patient = await db.query<PatientDemographics>(
        `SELECT id, documento, nombres, apellidos, fecha_nacimiento, email, celular, sexo, direccion
           FROM patients WHERE id = $1 FOR UPDATE`, [patientId],
      );
      if (!patient.rows.length) throw new NotFoundError('patient was not found');

      const assignment = await db.query<{ id: string; student_habilitation_id: string }>(
        `SELECT a.id::text AS id, a.student_habilitation_id
           FROM patient_assignments a
           JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
          WHERE a.patient_id = $1 AND p.student_id = $2 AND p.subject_id = $3
            AND p.academic_group_id = $4 AND a.ended_at IS NULL AND p.revoked_at IS NULL
          ORDER BY a.id FOR UPDATE OF a`,
        [patientId, student.rows[0].id, context.subjectId, context.groupId],
      );
      const activeAssignment = assignment.rows.find(row => periods.rows.some(period => period.id === row.student_habilitation_id));
      if (!activeAssignment) throw new NotFoundError('patient was not found');

      const historyInsert = await db.query<{ id: string }>(
        `INSERT INTO clinical_records (patient_id, created_by) VALUES ($1, $2)
         ON CONFLICT (patient_id) DO NOTHING RETURNING id::text AS id`,
        [patientId, actorId],
      );
      const history = historyInsert.rows[0] ?? (await db.query<{ id: string }>(
        'SELECT id::text AS id FROM clinical_records WHERE patient_id = $1', [patientId],
      )).rows[0];
      if (!history) throw new Error('clinical history was not available after atomic create/reuse');

      const result = await db.query<EvaluationRow>(
        `INSERT INTO kinesiology_evaluations
          (clinical_record_id, patient_id, author_id, origin_student_habilitation_id,
           origin_subject_id, origin_group_id, content, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft')
         RETURNING id::text AS id, clinical_record_id::text AS clinical_record_id, patient_id,
           author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id,
           content, created_at, updated_at`,
        [history.id, patientId, actorId, activeAssignment.student_habilitation_id,
          context.subjectId, context.groupId, JSON.stringify(content)],
      );
      return { ...result.rows[0], patient: patient.rows[0] };
    });
  }

  async submit(evaluationId: string, actorId: string) {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.findById(db, evaluationId);
      if (!hint || hint.author_id !== actorId) throw new NotFoundError('evaluation was not found');

      const student = await db.query<{ id: string }>(
        'SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [actorId],
      );
      if (!student.rows.length) throw new NotFoundError('evaluation was not found');
      const periods = await db.query<{ id: string }>(
        `SELECT id FROM student_academic_habilitations
          WHERE student_id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
          ORDER BY id FOR UPDATE`,
        [student.rows[0].id, hint.origin_subject_id, hint.origin_group_id],
      );
      if (!periods.rows.length) throw new NotFoundError('evaluation was not found');
      const patient = await db.query<PatientDemographics>(
        `SELECT id, documento, nombres, apellidos, fecha_nacimiento, email, celular, sexo, direccion
           FROM patients WHERE id = $1 FOR UPDATE`, [hint.patient_id],
      );
      if (!patient.rows.length) throw new NotFoundError('evaluation was not found');
      const assignments = await db.query<{ student_habilitation_id: string }>(
        `SELECT a.student_habilitation_id FROM patient_assignments a
           JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
          WHERE a.patient_id = $1 AND p.student_id = $2 AND p.subject_id = $3
            AND p.academic_group_id = $4 AND p.revoked_at IS NULL AND a.ended_at IS NULL
          ORDER BY a.id FOR UPDATE OF a`,
        [hint.patient_id, student.rows[0].id, hint.origin_subject_id, hint.origin_group_id],
      );
      if (!assignments.rows.some(a => periods.rows.some(p => p.id === a.student_habilitation_id))) {
        throw new NotFoundError('evaluation was not found');
      }
      const locked = await db.query<EvaluationRow>(
        `SELECT ${EVALUATION_COLUMNS.replaceAll('e.', '')}
           FROM kinesiology_evaluations e WHERE e.id = $1 FOR UPDATE`, [evaluationId],
      );
      const current = locked.rows[0];
      if (!current || current.author_id !== actorId || current.patient_id !== hint.patient_id ||
        current.origin_subject_id !== hint.origin_subject_id || current.origin_group_id !== hint.origin_group_id) {
        throw new NotFoundError('evaluation was not found');
      }
      if (current.status !== 'draft') throw new ConflictError('evaluation has already been submitted');
      const content = validateContent(current.content);
      if (!content.admission_date) throw new BadRequestError('admission_date is required for submission');
      for (const field of ['illness_history', 'admission_status', 'objectives', 'proposed_treatment'] as const) {
        if (typeof content[field] !== 'string' || !content[field]!.trim()) {
          throw new BadRequestError(`${field} is required for submission`);
        }
      }
      const consentResult = await db.query<{ id: string; paper_signature_date: string; verified_by: string; verified_at: Date | string }>(
        `SELECT id::text AS id, paper_signature_date::text AS paper_signature_date, verified_by, verified_at
           FROM kinesiology_consent_attestations WHERE evaluation_id = $1 ORDER BY id DESC LIMIT 1`, [evaluationId],
      );
      const consent = consentResult.rows[0];
      if (!consent) throw new ConflictError('verified paper consent is required before submission');
      const demographics = {
        id: patient.rows[0].id, documento: patient.rows[0].documento,
        nombres: patient.rows[0].nombres, apellidos: patient.rows[0].apellidos,
        fecha_nacimiento: dateOnly(patient.rows[0].fecha_nacimiento), email: patient.rows[0].email,
        celular: patient.rows[0].celular, sexo: patient.rows[0].sexo, direccion: patient.rows[0].direccion,
      };
      const inserted = await db.query<{ id: string; ordinal: string; submitted_at: Date | string }>(
        `INSERT INTO kinesiology_evaluation_submissions
          (evaluation_id, ordinal, submitted_by, clinical_content, patient_snapshot, age_at_admission, verified_consent_snapshot)
         SELECT $1, COALESCE(MAX(ordinal), 0) + 1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb
           FROM kinesiology_evaluation_submissions WHERE evaluation_id = $1
         RETURNING id::text AS id, ordinal::text AS ordinal, submitted_at`,
        [evaluationId, actorId, JSON.stringify(content), JSON.stringify(demographics),
          ageAtAdmission(patient.rows[0].fecha_nacimiento, content.admission_date), JSON.stringify({
            id: consent.id, paper_signature_date: consent.paper_signature_date,
            verified_by: consent.verified_by, verified_at: new Date(consent.verified_at).toISOString(),
          })],
      );
      const submission = inserted.rows[0];
      for (const [ordinal, study] of (content.studies ?? []).entries()) {
        await db.query(
          `INSERT INTO kinesiology_evaluation_submission_studies
            (submission_id, ordinal, study_type, description, study_date)
           VALUES ($1, $2, $3, $4, $5::date)`,
          [submission.id, ordinal, study.type, study.description, study.date ?? null],
        );
      }
      const updated = await db.query<{ id: string }>(
        `UPDATE kinesiology_evaluations SET status = 'submitted', updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'draft' RETURNING id::text AS id`, [evaluationId],
      );
      if (updated.rows.length === 0) throw new ConflictError('evaluation has already been submitted');
      return { id: submission.id, evaluation_id: evaluationId, ordinal: submission.ordinal,
        submitted_by: actorId, submitted_at: new Date(submission.submitted_at).toISOString(),
        status: 'pending_validation', clinical_content: content, studies: content.studies ?? [],
        patient: demographics, age_at_admission: ageAtAdmission(patient.rows[0].fecha_nacimiento, content.admission_date),
        consent: { id: consent.id, paper_signature_date: consent.paper_signature_date,
          verified_by: consent.verified_by, verified_at: new Date(consent.verified_at).toISOString() } };
    });
  }

  async requestCorrection(evaluationId: string, submissionId: string, reason: string, actorId: string) {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.findById(db, evaluationId);
      if (!hint) throw new NotFoundError('evaluation was not found');
      const context = await db.query<{ teacher_habilitation_id: string }>(
        `SELECT t.id, th.id::text AS teacher_habilitation_id
           FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
          WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3
            AND th.revoked_at IS NULL ORDER BY th.id FOR UPDATE OF th`,
        [actorId, hint.origin_subject_id, hint.origin_group_id],
      );
      if (!context.rows.length) throw new NotFoundError('evaluation was not found');
      const patient = await db.query<{ id: string }>(
        'SELECT id FROM patients WHERE id = $1 FOR UPDATE', [hint.patient_id],
      );
      if (!patient.rows.length) throw new NotFoundError('evaluation was not found');
      const locked = await db.query<EvaluationRow>(
        `SELECT ${EVALUATION_COLUMNS.replaceAll('e.', '')}
           FROM kinesiology_evaluations e WHERE e.id = $1 FOR UPDATE`, [evaluationId],
      );
      const current = locked.rows[0];
      if (!current || current.id !== hint.id || current.patient_id !== hint.patient_id ||
        current.author_id !== hint.author_id ||
        current.origin_student_habilitation_id !== hint.origin_student_habilitation_id ||
        current.origin_subject_id !== hint.origin_subject_id || current.origin_group_id !== hint.origin_group_id) {
        throw new NotFoundError('evaluation was not found');
      }
      if (current.status !== 'submitted') throw new ConflictError('evaluation is not awaiting correction');
      const target = await db.query<{ id: string; clinical_content: EvaluationContent }>(
        `SELECT id::text AS id, clinical_content FROM kinesiology_evaluation_submissions
          WHERE id = $1 AND evaluation_id = $2 FOR UPDATE`, [submissionId, evaluationId],
      );
      if (!target.rows.length) throw new NotFoundError('submission was not found');
      const latest = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM kinesiology_evaluation_submissions
          WHERE evaluation_id = $1 ORDER BY ordinal DESC LIMIT 1`, [evaluationId],
      );
      if (latest.rows[0]?.id !== submissionId) throw new ConflictError('submission is not the latest version');
      const event = await db.query<{ id: string; requested_at: Date | string }>(
        `INSERT INTO kinesiology_evaluation_correction_requests
          (evaluation_id, submission_id, reason, reviewed_by)
         VALUES ($1, $2, $3, $4) RETURNING id::text AS id, requested_at`,
        [evaluationId, submissionId, reason, actorId],
      );
      const updated = await db.query<{ id: string }>(
        `UPDATE kinesiology_evaluations SET content = $2::jsonb, status = 'draft',
          correction_from_submission_id = $3, updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'submitted' RETURNING id::text AS id`,
        [evaluationId, JSON.stringify(target.rows[0].clinical_content), submissionId],
      );
      if (!updated.rows.length) throw new ConflictError('evaluation is not awaiting correction');
      return { evaluation_id: evaluationId, submission_id: submissionId, status: 'draft',
        correction_request_id: event.rows[0].id, requested_at: new Date(event.rows[0].requested_at).toISOString() };
    });
  }

  async validate(evaluationId: string, submissionId: string, actorId: string) {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.findById(db, evaluationId);
      if (!hint) throw new NotFoundError('evaluation was not found');
      const contexts = await db.query<{ id: string; teacher_habilitation_id: string }>(
        `SELECT t.id, th.id::text AS teacher_habilitation_id
           FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
          WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3
            AND th.revoked_at IS NULL ORDER BY th.id FOR UPDATE OF th`,
        [actorId, hint.origin_subject_id, hint.origin_group_id],
      );
      if (!contexts.rows.length) throw new NotFoundError('evaluation was not found');
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [hint.patient_id]);
      if (!patient.rows.length) throw new NotFoundError('evaluation was not found');
      const locked = await db.query<EvaluationRow>(
        `SELECT ${EVALUATION_COLUMNS.replaceAll('e.', '')}
           FROM kinesiology_evaluations e WHERE e.id = $1 FOR UPDATE`, [evaluationId],
      );
      const current = locked.rows[0];
      if (!current || current.id !== hint.id || current.patient_id !== hint.patient_id ||
        current.author_id !== hint.author_id || current.origin_student_habilitation_id !== hint.origin_student_habilitation_id ||
        current.origin_subject_id !== hint.origin_subject_id || current.origin_group_id !== hint.origin_group_id) {
        throw new NotFoundError('evaluation was not found');
      }
      if (current.status !== 'submitted') throw new ConflictError('evaluation is not awaiting validation');
      const target = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM kinesiology_evaluation_submissions
          WHERE id = $1 AND evaluation_id = $2 FOR UPDATE`, [submissionId, evaluationId],
      );
      if (!target.rows.length) throw new NotFoundError('submission was not found');
      const latest = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM kinesiology_evaluation_submissions
          WHERE evaluation_id = $1 ORDER BY ordinal DESC LIMIT 1`, [evaluationId],
      );
      if (latest.rows[0]?.id !== submissionId) throw new ConflictError('submission is not the latest version');
      const event = await db.query<{ id: string; reviewed_at: Date | string }>(
        `INSERT INTO kinesiology_evaluation_validation_reviews
          (evaluation_id, submission_id, reviewed_by, teacher_habilitation_id)
         VALUES ($1, $2, $3, $4) RETURNING id::text AS id, reviewed_at`,
        [evaluationId, submissionId, actorId, contexts.rows[0].teacher_habilitation_id],
      );
      const updated = await db.query<{ id: string }>(
        `UPDATE kinesiology_evaluations SET status = 'validated', updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'submitted' RETURNING id::text AS id`, [evaluationId],
      );
      if (!updated.rows.length) throw new ConflictError('evaluation is not awaiting validation');
      return { evaluation_id: evaluationId, submission_id: submissionId, status: 'validated',
        reviewed_by: actorId, reviewed_at: new Date(event.rows[0].reviewed_at).toISOString() };
    });
  }

  async corrections(evaluationId: string, actorId: string) {
    await this.originDetail(evaluationId, actorId);
    const result = await this.pool.query<{ submission_id: string; reason: string; reviewed_by: string; requested_at: Date | string }>(
      `SELECT submission_id::text AS submission_id, reason, reviewed_by, requested_at
         FROM kinesiology_evaluation_correction_requests
        WHERE evaluation_id = $1 ORDER BY id`, [evaluationId],
    );
    return { evaluation_id: evaluationId, items: result.rows.map(row => ({ ...row,
      requested_at: new Date(row.requested_at).toISOString() })) };
  }

  async submissions(evaluationId: string, actorId: string) {
    const origin = originRead('$2');
    const cross = crossContextRead('$2');
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT s.id::text AS id, s.evaluation_id::text AS evaluation_id,
              s.ordinal::text AS ordinal, s.submitted_by, s.submitted_at,
              s.clinical_content, s.patient_snapshot AS patient, s.age_at_admission,
              s.verified_consent_snapshot AS consent,
              CASE WHEN validation.id IS NULL THEN 'pending_validation' ELSE 'validated' END AS validation_status,
              COALESCE((SELECT json_agg(json_build_object('type', study.study_type,
                'description', study.description, 'date', study.study_date::text) ORDER BY study.ordinal)
                FROM kinesiology_evaluation_submission_studies study WHERE study.submission_id = s.id), '[]'::json) AS studies
         FROM kinesiology_evaluation_submissions s
         JOIN kinesiology_evaluations e ON e.id = s.evaluation_id
         LEFT JOIN kinesiology_evaluation_validation_reviews validation
           ON validation.evaluation_id = s.evaluation_id AND validation.submission_id = s.id
        WHERE s.evaluation_id = $1 AND (
          ${origin} OR (${cross} AND s.id = (
            SELECT latest.id FROM kinesiology_evaluation_submissions latest
             WHERE latest.evaluation_id = e.id ORDER BY latest.ordinal DESC LIMIT 1
          ))
        ) ORDER BY s.ordinal`, [evaluationId, actorId],
    );
    // An empty authorized history is valid; private or absent evaluations are not.
    if (result.rows.length === 0) await this.detail(evaluationId, actorId);
    const items = result.rows.map(({ studies, validation_status, ...row }) => ({ ...row,
      submitted_at: new Date(row.submitted_at as string).toISOString(), status: validation_status, studies }));
    return { evaluation_id: evaluationId, items };
  }

  async edit(evaluationId: string, content: EvaluationContent, actorId: string): Promise<EvaluationRow> {
    return this.unitOfWork.withTransaction(async db => {
      // Unlocked hint only. All authorization and writes are revalidated after ordered locks.
      const hint = await this.findById(db, evaluationId);
      if (!hint) throw new NotFoundError('evaluation was not found');

      if (hint.author_id !== actorId) {
        const originTeacher = await db.query<{ id: string }>(
          `SELECT t.id FROM teachers t
             JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
            WHERE t.user_id = $1 AND th.subject_id = $2
              AND th.academic_group_id = $3 AND th.revoked_at IS NULL`,
          [actorId, hint.origin_subject_id, hint.origin_group_id],
        );
        if (!originTeacher.rows.length) throw new NotFoundError('evaluation was not found');
        throw new ForbiddenError('an active patient assignment is required');
      }

      const student = await db.query<{ id: string }>(
        'SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [actorId],
      );
      if (!student.rows.length) throw new ForbiddenError('an active patient assignment is required');
      const periods = await db.query<{ id: string }>(
        `SELECT id FROM student_academic_habilitations
          WHERE student_id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
          ORDER BY id FOR UPDATE`,
        [student.rows[0].id, hint.origin_subject_id, hint.origin_group_id],
      );
      if (!periods.rows.length) throw new ForbiddenError('an active patient assignment is required');

      const patient = await db.query<PatientDemographics>(
        `SELECT id, documento, nombres, apellidos, fecha_nacimiento, email, celular, sexo, direccion
           FROM patients WHERE id = $1 FOR UPDATE`, [hint.patient_id],
      );
      if (!patient.rows.length) throw new NotFoundError('evaluation was not found');

      const assignment = await db.query<{ id: string; student_habilitation_id: string }>(
        `SELECT a.id::text AS id, a.student_habilitation_id
           FROM patient_assignments a
           JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
          WHERE a.patient_id = $1 AND p.student_id = $2 AND p.subject_id = $3
            AND p.academic_group_id = $4 AND a.ended_at IS NULL AND p.revoked_at IS NULL
          ORDER BY a.id FOR UPDATE OF a`,
        [hint.patient_id, student.rows[0].id, hint.origin_subject_id, hint.origin_group_id],
      );
      if (!assignment.rows.some(row => periods.rows.some(period => period.id === row.student_habilitation_id))) {
        throw new NotFoundError('evaluation was not found');
      }

      const locked = await db.query<EvaluationRow>(
        `SELECT ${EVALUATION_COLUMNS.replaceAll('e.', '')}
           FROM kinesiology_evaluations e WHERE e.id = $1 FOR UPDATE`, [evaluationId],
      );
      const current = locked.rows[0];
      if (!current || current.author_id !== actorId || current.patient_id !== hint.patient_id ||
        current.origin_subject_id !== hint.origin_subject_id || current.origin_group_id !== hint.origin_group_id) {
        throw new NotFoundError('evaluation was not found');
      }
      const updated = await db.query<EvaluationRow>(
        `UPDATE kinesiology_evaluations SET content = $2::jsonb, updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'draft'
          RETURNING id::text AS id, clinical_record_id::text AS clinical_record_id, patient_id,
            author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id,
            content, created_at, updated_at`, [evaluationId, JSON.stringify(content)],
      );
      if (!updated.rows.length) throw new ConflictError('evaluation is not an editable draft');
      return { ...updated.rows[0], patient: patient.rows[0] };
    });
  }

  private async findById(db: Queryable, evaluationId: string): Promise<EvaluationRow | null> {
    const result = await db.query<EvaluationRow>(
      `SELECT id::text AS id, clinical_record_id::text AS clinical_record_id, patient_id,
        author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id,
        content, created_at, updated_at
       FROM kinesiology_evaluations WHERE id = $1`, [evaluationId],
    );
    return result.rows[0] ?? null;
  }

  async consent(evaluationId: string, actorId: string) {
    const evaluation = await this.originDetail(evaluationId, actorId);
    const result = await this.pool.query<{ id: string; paper_signature_date: string; verified_by: string; verified_at: Date | string }>(
      `SELECT id::text AS id, paper_signature_date::text AS paper_signature_date,
              verified_by, verified_at
         FROM kinesiology_consent_attestations WHERE evaluation_id = $1
        ORDER BY id DESC LIMIT 1`, [evaluationId],
    );
    const latest = result.rows[0];
    return {
      evaluation_id: evaluation.id,
      status: latest ? 'verified' : 'pending',
      evidence: latest ? { ...latest, verified_at: new Date(latest.verified_at).toISOString() } : null,
    };
  }

  async verifyConsent(evaluationId: string, paperSignatureDate: string, actorId: string) {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.findById(db, evaluationId);
      if (!hint) throw new NotFoundError('evaluation was not found');
      const context = await db.query<{ id: string; teacher_habilitation_id: string }>(
        `SELECT t.id, th.id::text AS teacher_habilitation_id
           FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
          WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3
            AND th.revoked_at IS NULL ORDER BY th.id FOR UPDATE OF th`,
        [actorId, hint.origin_subject_id, hint.origin_group_id],
      );
      // A fresh operation grant does not permit discovering private evaluations.
      if (!context.rows.length) throw new NotFoundError('evaluation was not found');
      const patient = await db.query<{ id: string }>(
        'SELECT id FROM patients WHERE id = $1 FOR UPDATE', [hint.patient_id],
      );
      if (!patient.rows.length) throw new NotFoundError('evaluation was not found');
      const locked = await db.query<EvaluationRow>(
        `SELECT ${EVALUATION_COLUMNS.replaceAll('e.', '')}
           FROM kinesiology_evaluations e WHERE e.id = $1 FOR UPDATE`, [evaluationId],
      );
      const current = locked.rows[0];
      if (!current || current.patient_id !== hint.patient_id ||
        current.origin_subject_id !== hint.origin_subject_id || current.origin_group_id !== hint.origin_group_id) {
        throw new NotFoundError('evaluation was not found');
      }
      const result = await db.query<{ id: string; paper_signature_date: string; verified_by: string; verified_at: Date | string }>(
        `INSERT INTO kinesiology_consent_attestations
          (evaluation_id, paper_signature_date, verified_by, teacher_habilitation_id)
         VALUES ($1, $2::date, $3, $4)
         RETURNING id::text AS id, paper_signature_date::text AS paper_signature_date,
                   verified_by, verified_at`,
        [evaluationId, paperSignatureDate, actorId, context.rows[0].teacher_habilitation_id],
      );
      const evidence = result.rows[0];
      return { evaluation_id: evaluationId, status: 'verified', evidence: {
        ...evidence, verified_at: new Date(evidence.verified_at).toISOString(),
      } };
    });
  }

  async detail(evaluationId: string, actorId: string): Promise<EvaluationRow> {
    const origin = originRead('$2');
    const cross = crossContextRead('$2');
    const result = await this.pool.query<EvaluationReadRow>(
      `SELECT ${projectedReadColumns(origin)}
         FROM kinesiology_evaluations e JOIN patients p ON p.id = e.patient_id
         LEFT JOIN LATERAL (
           SELECT s.id, s.ordinal, s.submitted_by, s.submitted_at, s.clinical_content,
                  s.patient_snapshot, s.age_at_admission, s.verified_consent_snapshot
             FROM kinesiology_evaluation_submissions s
            WHERE s.evaluation_id = e.id ORDER BY s.ordinal DESC LIMIT 1
         ) snapshot ON true
        LEFT JOIN LATERAL (SELECT r.id FROM kinesiology_evaluation_validation_reviews r
          WHERE r.evaluation_id = e.id AND r.submission_id = snapshot.id LIMIT 1) validation ON true
        WHERE e.id = $1 AND (${origin} OR (snapshot.id IS NOT NULL AND ${cross}))`,
      [evaluationId, actorId],
    );
    if (!result.rows.length) throw new NotFoundError('evaluation was not found');
    return withPatient(result.rows[0]);
  }

  private async originDetail(evaluationId: string, actorId: string): Promise<EvaluationRow> {
    const result = await this.pool.query<EvaluationReadRow>(
      `SELECT ${EVALUATION_COLUMNS}, p.documento AS patient_documento, p.nombres AS patient_nombres,
              p.apellidos AS patient_apellidos, p.fecha_nacimiento AS patient_fecha_nacimiento,
              p.email AS patient_email, p.celular AS patient_celular, p.sexo AS patient_sexo,
              p.direccion AS patient_direccion
         FROM kinesiology_evaluations e JOIN patients p ON p.id = e.patient_id
        WHERE e.id = $1 AND ${originRead('$2')}`,
      [evaluationId, actorId],
    );
    if (!result.rows.length) throw new NotFoundError('evaluation was not found');
    return withPatient(result.rows[0]);
  }

  async list(patientId: string, actorId: string, subjectId?: string, groupId?: string): Promise<EvaluationRow[]> {
    const params: unknown[] = [actorId, patientId];
    const filters: string[] = ['e.patient_id = $2'];
    if (subjectId) { params.push(subjectId); filters.push(`e.origin_subject_id = $${params.length}`); }
    if (groupId) { params.push(groupId); filters.push(`e.origin_group_id = $${params.length}`); }
    const origin = originRead('$1');
    const cross = crossContextRead('$1');
    const result = await this.pool.query<EvaluationReadRow>(
      `SELECT ${projectedReadColumns(origin)}
         FROM kinesiology_evaluations e JOIN patients p ON p.id = e.patient_id
         LEFT JOIN LATERAL (
           SELECT s.id, s.ordinal, s.submitted_by, s.submitted_at, s.clinical_content,
                  s.patient_snapshot, s.age_at_admission, s.verified_consent_snapshot
             FROM kinesiology_evaluation_submissions s
            WHERE s.evaluation_id = e.id ORDER BY s.ordinal DESC LIMIT 1
         ) snapshot ON true
        LEFT JOIN LATERAL (SELECT r.id FROM kinesiology_evaluation_validation_reviews r
          WHERE r.evaluation_id = e.id AND r.submission_id = snapshot.id LIMIT 1) validation ON true
        WHERE ${filters.join(' AND ')} AND (${origin} OR (snapshot.id IS NOT NULL AND ${cross}))
        ORDER BY e.id`, params,
    );
    return result.rows.map(withPatient);
  }
}

function withPatient(row: EvaluationReadRow): EvaluationRow {
  return {
    ...row,
    patient: {
      id: row.patient_id,
      documento: String(row.patient_documento),
      nombres: String(row.patient_nombres),
      apellidos: String(row.patient_apellidos),
      fecha_nacimiento: row.patient_fecha_nacimiento as Date | string,
      email: String(row.patient_email),
      celular: String(row.patient_celular),
      sexo: String(row.patient_sexo),
      direccion: String(row.patient_direccion),
    },
  };
}

function submissionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new BadRequestError('submission_id must be a positive BIGINT decimal string');
  }
  return value;
}

function queryUuid(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  return requireUuid(value, field);
}

export function createKinesiologyEvaluationRouter({
  repository,
  writeGuard = new PermissionGuard('kinesiology-evaluations:write'),
  readGuard = new PermissionGuard('kinesiology-evaluations:read'),
  getActor = defaultGetActor,
}: {
  repository: PgKinesiologyEvaluationRepository;
  writeGuard?: Guard;
  readGuard?: Guard;
  getActor?: (request: Request) => Promise<string | null>;
}): Router {
  const router = Router();

  router.post('/', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => !['patient_id', 'subject_id', 'academic_group_id', 'content'].includes(key))) {
      throw new BadRequestError('body may contain only patient_id, subject_id, academic_group_id and content');
    }
    const patientId = requireUuid(body.patient_id, 'patient_id');
    const subjectId = requireUuid(body.subject_id, 'subject_id');
    const groupId = requireUuid(body.academic_group_id, 'academic_group_id');
    response.status(201).json(serialize(await repository.create(
      patientId, { subjectId, groupId }, validateContent(body.content), actor,
    )));
  });

  router.post('/:id/submissions', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:submit').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).length) throw new BadRequestError('body must be an empty object');
    response.status(201).json(await repository.submit(evaluationId(request.params.id), actor));
  });

  router.post('/:id/validations', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:review').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => key !== 'submission_id')) {
      throw new BadRequestError('body may contain only submission_id');
    }
    response.status(201).json(await repository.validate(
      evaluationId(request.params.id), submissionId(body.submission_id), actor,
    ));
  });

  router.post('/:id/corrections', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:review').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => !['submission_id', 'reason'].includes(key))) {
      throw new BadRequestError('body may contain only submission_id and reason');
    }
    const target = submissionId(body.submission_id);
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      throw new BadRequestError('reason must be a non-empty string');
    }
    response.status(201).json(await repository.requestCorrection(
      evaluationId(request.params.id), target, body.reason.trim(), actor,
    ));
  });

  router.get('/:id/corrections', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(await repository.corrections(evaluationId(request.params.id), actor));
  });

  router.get('/:id/submissions', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(await repository.submissions(evaluationId(request.params.id), actor));
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => key !== 'content')) throw new BadRequestError('body may contain only content');
    response.json(serialize(await repository.edit(evaluationId(request.params.id), validateContent(body.content), actor)));
  });

  router.get('/:id/consent', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(await repository.consent(evaluationId(request.params.id), actor));
  });

  router.post('/:id/consent', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:verify-consent').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => key !== 'paper_signature_date')) {
      throw new BadRequestError('body may contain only paper_signature_date');
    }
    const paperSignatureDate = validateDate(body.paper_signature_date, 'paper_signature_date');
    if (paperSignatureDate === null) throw new BadRequestError('paper_signature_date is required');
    response.status(201).json(await repository.verifyConsent(evaluationId(request.params.id), paperSignatureDate, actor));
  });

  router.get('/:id', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(serialize(await repository.detail(evaluationId(request.params.id), actor)));
  });

  router.get('/', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const patientId = queryUuid(request.query.patient_id, 'patient_id', true)!;
    const subjectId = queryUuid(request.query.subject_id, 'subject_id', false);
    const groupId = queryUuid(request.query.academic_group_id, 'academic_group_id', false);
    response.json({ items: (await repository.list(patientId, actor, subjectId, groupId)).map(serialize) });
  });
  return router;
}
