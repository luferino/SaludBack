import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { ageAtAdmission, dateOnly, submissionContent } from '../../domain/evaluation.js';
import type { EvaluationContent, PatientDemographics } from '../../domain/evaluation.js';
import type { EvaluationRepositoryPort, EvaluationView as EvaluationRow, EvaluationContext as Context } from '../../application/evaluation.ports.js';

interface EvaluationReadRow extends EvaluationRow {
  patient_documento: string;
  patient_nombres: string;
  patient_apellidos: string;
  patient_fecha_nacimiento: Date | string;
  patient_email: string;
  patient_celular: string;
  patient_sexo: string;
  patient_direccion: string;
}

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
    CASE WHEN ${origin} THEN p.direccion ELSE snapshot.patient_snapshot->>'direccion' END AS patient_direccion,
    (SELECT link.original_evaluation_id::text FROM kinesiology_evaluation_amendment_links link
      WHERE link.amendment_evaluation_id = e.id) AS amendment_of_evaluation_id`;
}

export class PgKinesiologyEvaluationRepository implements EvaluationRepositoryPort {
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

  async createAmendment(originalEvaluationId: string, actorId: string): Promise<EvaluationRow> {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.findById(db, originalEvaluationId);
      if (!hint) throw new NotFoundError('evaluation was not found');
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
      const assignments = await db.query<{ id: string; student_habilitation_id: string }>(
        `SELECT a.id::text AS id, a.student_habilitation_id
           FROM patient_assignments a JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
          WHERE a.patient_id = $1 AND p.student_id = $2 AND p.subject_id = $3
            AND p.academic_group_id = $4 AND p.revoked_at IS NULL AND a.ended_at IS NULL
          ORDER BY a.id FOR UPDATE OF a`,
        [hint.patient_id, student.rows[0].id, hint.origin_subject_id, hint.origin_group_id],
      );
      const assignment = assignments.rows.find(row => periods.rows.some(period => period.id === row.student_habilitation_id));
      if (!assignment) throw new NotFoundError('evaluation was not found');

      const locked = await db.query<EvaluationRow>(
        `SELECT ${EVALUATION_COLUMNS.replaceAll('e.', '')}
           FROM kinesiology_evaluations e WHERE e.id = $1 FOR UPDATE`, [originalEvaluationId],
      );
      const original = locked.rows[0];
      if (!original || original.id !== hint.id || original.patient_id !== hint.patient_id ||
        original.author_id !== hint.author_id || original.origin_student_habilitation_id !== hint.origin_student_habilitation_id ||
        original.origin_subject_id !== hint.origin_subject_id || original.origin_group_id !== hint.origin_group_id) {
        throw new NotFoundError('evaluation was not found');
      }
      if (original.status !== 'validated') throw new ConflictError('only a validated evaluation can be amended');
      const snapshot = await db.query<{ id: string; clinical_content: EvaluationContent }>(
        `SELECT s.id::text AS id, s.clinical_content FROM kinesiology_evaluation_submissions s
          JOIN kinesiology_evaluation_validation_reviews review
            ON review.evaluation_id = s.evaluation_id AND review.submission_id = s.id
         WHERE s.evaluation_id = $1 ORDER BY s.ordinal DESC LIMIT 1 FOR UPDATE OF s`, [originalEvaluationId],
      );
      if (!snapshot.rows.length) throw new ConflictError('validated submission is unavailable');
      const inserted = await db.query<EvaluationRow>(
        `INSERT INTO kinesiology_evaluations
          (clinical_record_id, patient_id, author_id, origin_student_habilitation_id,
           origin_subject_id, origin_group_id, content, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft')
         RETURNING id::text AS id, clinical_record_id::text AS clinical_record_id, patient_id,
           author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id,
           content, created_at, updated_at, status`,
        [original.clinical_record_id, original.patient_id, actorId, assignment.student_habilitation_id,
          original.origin_subject_id, original.origin_group_id, JSON.stringify(snapshot.rows[0].clinical_content)],
      );
      const amendment = inserted.rows[0];
      await db.query(
        `INSERT INTO kinesiology_evaluation_amendment_links
          (original_evaluation_id, amendment_evaluation_id, patient_id, origin_subject_id, origin_group_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [originalEvaluationId, amendment.id, original.patient_id, original.origin_subject_id, original.origin_group_id, actorId],
      );
      return { ...amendment, patient: patient.rows[0], amendment_of_evaluation_id: originalEvaluationId };
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
      const content = submissionContent(current.content);
      const consentResult = await db.query<{ id: string; paper_signature_date: string; verified_by: string; verified_at: Date | string }>(
        `SELECT id::text AS id, paper_signature_date::text AS paper_signature_date, verified_by, verified_at
           FROM kinesiology_consent_attestations WHERE evaluation_id = $1 ORDER BY id DESC LIMIT 1`, [evaluationId],
      );
      let consent = consentResult.rows[0];
      if (!consent) {
        const inherited = await db.query<{ id: string; paper_signature_date: string; verified_by: string; verified_at: Date | string }>(
          `SELECT (s.verified_consent_snapshot->>'id') AS id,
                  s.verified_consent_snapshot->>'paper_signature_date' AS paper_signature_date,
                  s.verified_consent_snapshot->>'verified_by' AS verified_by,
                  (s.verified_consent_snapshot->>'verified_at')::timestamptz AS verified_at
             FROM kinesiology_evaluation_amendment_links link
             JOIN kinesiology_evaluation_submissions s ON s.evaluation_id = link.original_evaluation_id
             JOIN kinesiology_evaluation_validation_reviews review
               ON review.evaluation_id = s.evaluation_id AND review.submission_id = s.id
            WHERE link.amendment_evaluation_id = $1
            ORDER BY s.ordinal DESC LIMIT 1`, [evaluationId],
        );
        consent = inherited.rows[0];
      }
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
              (SELECT link.original_evaluation_id::text FROM kinesiology_evaluation_amendment_links link
                WHERE link.amendment_evaluation_id = e.id) AS amendment_of_evaluation_id,
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
    const authorized = result.rows.length === 0 ? await this.detail(evaluationId, actorId) : null;
    const amendmentOf = result.rows[0]?.amendment_of_evaluation_id ?? authorized?.amendment_of_evaluation_id ?? null;
    const items = result.rows.map(({ studies, validation_status, amendment_of_evaluation_id: _amendmentOf, ...row }) => ({ ...row,
      submitted_at: new Date(row.submitted_at as string).toISOString(), status: validation_status, studies }));
    return { evaluation_id: evaluationId,
      ...(amendmentOf ? { amendment_of_evaluation_id: amendmentOf } : {}), items };
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
