import type { Pool } from 'pg';
import type { UnitOfWorkPort, Queryable } from '../../../shared/application/unit-of-work.js';
import { ForbiddenError, NotFoundError, ConflictError } from '../../../shared/domain/errors.js';
import type { EvolutionCorrection, EvolutionCorrectionResult, EvolutionRepositoryPort, EvolutionSubmission, EvolutionValidationResult, EvolutionView } from '../../application/evolution.ports.js';
import { validateEvolutionSubmission } from '../../domain/evolution.js';
import type { EvolutionContent } from '../../domain/evolution.js';

const columns = `id::text AS id, clinical_record_id::text AS clinical_record_id, evaluation_id::text AS evaluation_id,
 patient_id, author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id,
 content, status, created_at, updated_at`;
const documentColumns = `e.id::text AS id, e.clinical_record_id::text AS clinical_record_id,
 e.evaluation_id::text AS evaluation_id, e.patient_id, e.author_id,
 e.origin_student_habilitation_id, e.origin_subject_id, e.origin_group_id,
 CASE WHEN ${originRead('$2')} THEN e.content ELSE latest.clinical_content END AS content,
 CASE WHEN ${originRead('$2')} THEN e.status ELSE latest.projected_status END AS status,
 CASE WHEN ${originRead('$2')} THEN e.created_at ELSE latest.submitted_at END AS created_at,
 CASE WHEN ${originRead('$2')} THEN e.updated_at ELSE latest.submitted_at END AS updated_at,
 latest.id::text AS projected_submission_id, latest.submitted_by AS projected_submitted_by,
 latest.submitted_at AS projected_submitted_at, latest.reviewed_by AS projected_reviewed_by,
 latest.reviewed_at AS projected_reviewed_at,
 latest.validation_status AS validation_status,
 amendment.original_evolution_id::text AS amendment_of_evolution_id`;
const latestSubmissionJoin = `LEFT JOIN kinesiology_evolution_amendment_links amendment ON amendment.amendment_evolution_id = e.id
LEFT JOIN LATERAL (
 SELECT s.id, s.submitted_by, s.submitted_at, s.clinical_content,
        review.reviewed_by, review.reviewed_at,
        CASE WHEN review.id IS NULL THEN 'submitted' ELSE 'validated' END AS projected_status,
        CASE WHEN review.id IS NULL THEN 'pending_validation' ELSE 'validated' END AS validation_status
 FROM kinesiology_evolution_submissions s
 LEFT JOIN kinesiology_evolution_validation_reviews review
   ON review.evolution_id = s.evolution_id AND review.submission_id = s.id
 WHERE s.evolution_id = e.id ORDER BY s.ordinal DESC LIMIT 1
) latest ON true`;

function originRead(actor: string): string {
  return `(e.author_id = ${actor} AND EXISTS (
    SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
    JOIN patient_assignments a ON a.student_habilitation_id = sp.id
    WHERE s.user_id = ${actor} AND a.patient_id = e.patient_id
      AND a.subject_id = sp.subject_id AND sp.subject_id = e.origin_subject_id
      AND sp.academic_group_id = e.origin_group_id AND sp.revoked_at IS NULL AND a.ended_at IS NULL
  )) OR EXISTS (
    SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
    WHERE t.user_id = ${actor} AND th.subject_id = e.origin_subject_id
      AND th.academic_group_id = e.origin_group_id AND th.revoked_at IS NULL
  )`;
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
const inaccessible = () => new NotFoundError('evolution was not found');

export class PgKinesiologyEvolutionRepository implements EvolutionRepositoryPort {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  async create(input: { evaluationId: string; patientId: string; subjectId: string; groupId: string; content: EvolutionContent; actorId: string }): Promise<EvolutionView> {
    return this.unitOfWork.withTransaction(async db => {
      const student = await db.query<{ id: string }>('SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [input.actorId]);
      if (!student.rows.length) throw new ForbiddenError('an active student context is required');
      const periods = await db.query<{ id: string }>(`SELECT id FROM student_academic_habilitations
        WHERE student_id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
        ORDER BY id FOR UPDATE`, [student.rows[0].id, input.subjectId, input.groupId]);
      if (!periods.rows.length) throw new ForbiddenError('an active student context is required');
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [input.patientId]);
      if (!patient.rows.length) throw new NotFoundError('patient was not found');
      const assignments = await db.query<{ id: string; student_habilitation_id: string }>(`SELECT a.id::text AS id, a.student_habilitation_id
        FROM patient_assignments a JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
        WHERE a.patient_id = $1 AND a.subject_id = $2 AND p.academic_group_id = $3
          AND p.student_id = $4 AND p.subject_id = a.subject_id
          AND p.revoked_at IS NULL AND a.ended_at IS NULL
        ORDER BY a.id FOR UPDATE OF a`, [input.patientId, input.subjectId, input.groupId, student.rows[0].id]);
      const assignment = assignments.rows.find(row => periods.rows.some(period => period.id === row.student_habilitation_id));
      if (!assignment) throw new NotFoundError('patient was not found');
      const evaluation = await db.query<{ id: string; clinical_record_id: string; patient_id: string; status: string; origin_subject_id: string; origin_group_id: string }>(
        `SELECT e.id::text AS id, e.clinical_record_id::text AS clinical_record_id, e.patient_id, e.status, e.origin_subject_id, e.origin_group_id
           FROM kinesiology_evaluations e WHERE e.id = $1 AND e.patient_id = $2 AND e.status = 'validated'
             AND (EXISTS (SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
               JOIN patient_assignments a ON a.student_habilitation_id = sp.id WHERE s.user_id = $3 AND a.patient_id = e.patient_id
                 AND a.subject_id = sp.subject_id AND sp.revoked_at IS NULL AND a.ended_at IS NULL)
               OR EXISTS (SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
                 WHERE t.user_id = $3 AND th.subject_id = e.origin_subject_id AND th.academic_group_id = e.origin_group_id AND th.revoked_at IS NULL))
           FOR UPDATE`, [input.evaluationId, input.patientId, input.actorId]);
      if (!evaluation.rows.length) throw inaccessible();
      const record = await db.query<{ id: string }>('SELECT id::text AS id FROM clinical_records WHERE patient_id = $1 AND id = $2', [input.patientId, evaluation.rows[0].clinical_record_id]);
      if (!record.rows.length) throw inaccessible();
      const inserted = await db.query<EvolutionView>(`INSERT INTO kinesiology_evolutions
        (clinical_record_id, patient_id, evaluation_id, author_id, origin_student_habilitation_id,
         origin_subject_id, origin_group_id, content, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'draft') RETURNING ${columns}`,
        [record.rows[0].id, input.patientId, input.evaluationId, input.actorId, assignment.student_habilitation_id,
          input.subjectId, input.groupId, JSON.stringify(input.content)]);
      return inserted.rows[0];
    });
  }

  async createAmendment(id: string, actorId: string): Promise<EvolutionView> {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.find(db, id);
      if (!hint) throw inaccessible();
      const periods = await this.lockStudent(db, actorId, hint);
      if (!periods.length) throw inaccessible();
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [hint.patient_id]);
      if (!patient.rows.length) throw inaccessible();
      const assignments = await this.activeAssignments(db, hint.patient_id, actorId, hint.origin_subject_id, hint.origin_group_id);
      const assignment = assignments.find(item => periods.includes(item.student_habilitation_id));
      if (!assignment) throw inaccessible();
      const original = await this.find(db, id, true);
      if (!this.sameIdentity(original, hint)) throw inaccessible();
      if (original.status !== 'validated') throw new ConflictError('evolution is not validated');
      const snapshot = await db.query<{ id: string; clinical_content: EvolutionContent }>(`SELECT s.id::text AS id, s.clinical_content
        FROM kinesiology_evolution_submissions s
        JOIN kinesiology_evolution_validation_reviews r ON r.evolution_id = s.evolution_id AND r.submission_id = s.id
        WHERE s.evolution_id = $1 ORDER BY s.ordinal DESC LIMIT 1 FOR UPDATE OF s`, [id]);
      if (!snapshot.rows.length) throw inaccessible();
      const latest = await db.query<{ id: string }>(`SELECT id::text AS id FROM kinesiology_evolution_submissions
        WHERE evolution_id = $1 ORDER BY ordinal DESC LIMIT 1`, [id]);
      if (latest.rows[0]?.id !== snapshot.rows[0].id) throw new ConflictError('validated evolution changed while creating amendment');
      const locked = await this.find(db, id, true);
      if (!this.sameIdentity(locked, hint) || locked.status !== 'validated') throw inaccessible();
      const inserted = await db.query<EvolutionView>(`INSERT INTO kinesiology_evolutions
        (clinical_record_id, patient_id, evaluation_id, author_id, origin_student_habilitation_id,
         origin_subject_id, origin_group_id, content, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'draft') RETURNING ${columns}`,
        [hint.clinical_record_id, hint.patient_id, hint.evaluation_id, actorId, assignment.student_habilitation_id,
          hint.origin_subject_id, hint.origin_group_id, JSON.stringify(snapshot.rows[0].clinical_content)]);
      const child = inserted.rows[0];
      await db.query(`INSERT INTO kinesiology_evolution_amendment_links
        (amendment_evolution_id, original_evolution_id, evaluation_id, clinical_record_id, patient_id, origin_subject_id, origin_group_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [child.id, hint.id, hint.evaluation_id, hint.clinical_record_id,
        hint.patient_id, hint.origin_subject_id, hint.origin_group_id]);
      return { ...child, amendment_of_evolution_id: hint.id };
    });
  }

  async edit(id: string, content: EvolutionContent, actorId: string): Promise<EvolutionView> {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.find(db, id);
      if (!hint || !(await this.canRead(db, id, actorId))) throw inaccessible();
      if (hint.author_id !== actorId) throw new ForbiddenError('only the evolution author can edit it');
      const context = await this.lockStudent(db, actorId, hint);
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [hint.patient_id]);
      if (!patient.rows.length) throw inaccessible();
      const assignments = await this.activeAssignments(db, hint.patient_id, actorId, hint.origin_subject_id, hint.origin_group_id);
      if (!assignments.some(assignment => context.includes(assignment.student_habilitation_id))) throw inaccessible();
      const locked = await this.find(db, id, true);
      if (!this.sameIdentity(locked, hint) || locked.author_id !== actorId) {
        throw inaccessible();
      }
      if (locked.status !== 'draft') throw new ConflictError('evolution is not an editable draft');
      const updated = await db.query<EvolutionView>(`UPDATE kinesiology_evolutions SET content = $2::jsonb, updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'draft' RETURNING ${columns}`, [id, JSON.stringify(content)]);
      if (!updated.rows.length) throw new ConflictError('evolution is not an editable draft');
      const amendment = await db.query<{ original_evolution_id: string }>(`SELECT original_evolution_id::text AS original_evolution_id
        FROM kinesiology_evolution_amendment_links WHERE amendment_evolution_id = $1`, [id]);
      return { ...updated.rows[0], ...(amendment.rows[0] ? { amendment_of_evolution_id: amendment.rows[0].original_evolution_id } : {}) };
    });
  }

  async submit(id: string, actorId: string) {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.find(db, id);
      if (!hint || hint.author_id !== actorId) throw inaccessible();
      const periods = await this.lockStudent(db, actorId, hint);
      if (!periods.length) throw inaccessible();
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [hint.patient_id]);
      if (!patient.rows.length) throw inaccessible();
      const assignments = await this.activeAssignments(db, hint.patient_id, actorId, hint.origin_subject_id, hint.origin_group_id);
      if (!assignments.some(a => periods.includes(a.student_habilitation_id))) throw inaccessible();
      const current = await this.find(db, id, true);
      if (!this.sameIdentity(current, hint) || current.author_id !== actorId) throw inaccessible();
      if (current.status !== 'draft') throw new ConflictError('evolution is not an editable draft');
      const content = validateEvolutionSubmission(current.content);
      const snapshot = await db.query<{ id: string; ordinal: string; submitted_at: Date | string }>(
        `INSERT INTO kinesiology_evolution_submissions (evolution_id, ordinal, submitted_by, clinical_content)
         SELECT $1, COALESCE(MAX(ordinal), 0) + 1, $2, $3::jsonb FROM kinesiology_evolution_submissions WHERE evolution_id = $1
         RETURNING id::text AS id, ordinal::text AS ordinal, submitted_at`, [id, actorId, JSON.stringify(content)]);
      const update = await db.query(`UPDATE kinesiology_evolutions SET status = 'submitted', updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'draft' RETURNING id`, [id]);
      if (!update.rows.length) throw new ConflictError('evolution is not an editable draft');
      const row = snapshot.rows[0];
      const amendment = await db.query<{ original_evolution_id: string }>(`SELECT original_evolution_id::text AS original_evolution_id
        FROM kinesiology_evolution_amendment_links WHERE amendment_evolution_id = $1`, [id]);
      return { id: row.id, evolution_id: id, ordinal: row.ordinal, submitted_by: actorId,
        submitted_at: new Date(row.submitted_at).toISOString(), content, validation_status: 'pending_validation' as const,
        ...(amendment.rows[0] ? { amendment_of_evolution_id: amendment.rows[0].original_evolution_id } : {}) };
    });
  }

  async requestCorrection(id: string, submissionId: string, reason: string, actorId: string): Promise<EvolutionCorrectionResult> {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.find(db, id); if (!hint) throw inaccessible();
      const teacher = await db.query<{ teacher_habilitation_id: string }>(`SELECT th.id::text AS teacher_habilitation_id FROM teachers t
        JOIN teacher_academic_habilitations th ON th.teacher_id = t.id WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3
        AND th.revoked_at IS NULL ORDER BY th.id FOR UPDATE OF th`, [actorId, hint.origin_subject_id, hint.origin_group_id]);
      if (!teacher.rows.length) throw inaccessible();
      await this.lockDocument(db, hint);
      const current = await this.find(db, id, true);
      if (!this.sameIdentity(current, hint)) throw inaccessible();
      if (current!.status !== 'submitted') throw new ConflictError('evolution is not awaiting correction');
      const target = await db.query<{ id: string; clinical_content: EvolutionContent }>(`SELECT id::text AS id, clinical_content FROM kinesiology_evolution_submissions WHERE id = $1 AND evolution_id = $2 FOR UPDATE`, [submissionId, id]);
      if (!target.rows.length) throw new NotFoundError('submission was not found');
      const latest = await db.query<{ id: string }>(`SELECT id::text AS id FROM kinesiology_evolution_submissions WHERE evolution_id = $1 ORDER BY ordinal DESC LIMIT 1`, [id]);
      if (latest.rows[0]?.id !== submissionId) throw new ConflictError('submission is not the latest version');
      const event = await db.query<{ id: string; requested_at: Date | string }>(`INSERT INTO kinesiology_evolution_correction_requests (evolution_id, submission_id, reason, reviewed_by) VALUES ($1, $2, $3, $4) RETURNING id::text AS id, requested_at`, [id, submissionId, reason, actorId]);
      const updated = await db.query(`UPDATE kinesiology_evolutions SET content = $2::jsonb, status = 'draft', updated_at = clock_timestamp() WHERE id = $1 AND status = 'submitted' RETURNING id`, [id, JSON.stringify(target.rows[0].clinical_content)]);
      if (!updated.rows.length) throw new ConflictError('evolution is not awaiting correction');
      const amendment = await db.query<{ original_evolution_id: string }>(`SELECT original_evolution_id::text AS original_evolution_id
        FROM kinesiology_evolution_amendment_links WHERE amendment_evolution_id = $1`, [id]);
      return { evolution_id: id, submission_id: submissionId, correction_request_id: event.rows[0].id,
        reason, reviewed_by: actorId, requested_at: new Date(event.rows[0].requested_at).toISOString(), status: 'draft',
        ...(amendment.rows[0] ? { amendment_of_evolution_id: amendment.rows[0].original_evolution_id } : {}) };
    });
  }

  async validate(id: string, submissionId: string, actorId: string): Promise<EvolutionValidationResult> {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.find(db, id); if (!hint) throw inaccessible();
      const teacher = await db.query<{ teacher_habilitation_id: string }>(`SELECT th.id::text AS teacher_habilitation_id FROM teachers t
        JOIN teacher_academic_habilitations th ON th.teacher_id = t.id WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3
        AND th.revoked_at IS NULL ORDER BY th.id FOR UPDATE OF th`, [actorId, hint.origin_subject_id, hint.origin_group_id]);
      if (!teacher.rows.length) throw inaccessible();
      await this.lockDocument(db, hint);
      const current = await this.find(db, id, true);
      if (!this.sameIdentity(current, hint)) throw inaccessible();
      if (current!.status !== 'submitted') throw new ConflictError('evolution is not awaiting validation');
      const target = await db.query<{ id: string }>(`SELECT id::text AS id FROM kinesiology_evolution_submissions WHERE id = $1 AND evolution_id = $2 FOR UPDATE`, [submissionId, id]);
      if (!target.rows.length) throw new NotFoundError('submission was not found');
      const latest = await db.query<{ id: string }>(`SELECT id::text AS id FROM kinesiology_evolution_submissions WHERE evolution_id = $1 ORDER BY ordinal DESC LIMIT 1`, [id]);
      if (latest.rows[0]?.id !== submissionId) throw new ConflictError('submission is not the latest version');
      const event = await db.query<{ reviewed_at: Date | string }>(`INSERT INTO kinesiology_evolution_validation_reviews (evolution_id, submission_id, reviewed_by, teacher_habilitation_id) VALUES ($1, $2, $3, $4) RETURNING reviewed_at`, [id, submissionId, actorId, teacher.rows[0].teacher_habilitation_id]);
      const update = await db.query(`UPDATE kinesiology_evolutions SET status = 'validated', updated_at = clock_timestamp() WHERE id = $1 AND status = 'submitted' RETURNING id`, [id]);
      if (!update.rows.length) throw new ConflictError('evolution is not awaiting validation');
      return { evolution_id: id, submission_id: submissionId, status: 'validated', reviewed_by: actorId, reviewed_at: new Date(event.rows[0].reviewed_at).toISOString() };
    });
  }

  async submissions(id: string, actorId: string): Promise<{ evolution_id: string; items: EvolutionSubmission[] }> {
    const origin = originRead('$2');
    const cross = crossContextRead('$2');
    const result = await this.pool.query<EvolutionSubmission & { visible_evolution_id: string | null; amendment_of_evolution_id: string | null }>(`SELECT e.id::text AS visible_evolution_id,
      amendment.original_evolution_id::text AS amendment_of_evolution_id,
      s.id::text AS id, s.evolution_id::text AS evolution_id, s.ordinal::text AS ordinal,
      s.submitted_by, s.submitted_at, s.clinical_content AS content,
      CASE WHEN review.id IS NULL THEN 'pending_validation' ELSE 'validated' END AS validation_status,
      review.reviewed_by, review.reviewed_at
      FROM kinesiology_evolutions e ${latestSubmissionJoin}
      LEFT JOIN kinesiology_evolution_submissions s ON s.evolution_id = e.id
        AND ((${origin}) OR s.id = latest.id)
      LEFT JOIN kinesiology_evolution_validation_reviews review
        ON review.evolution_id = s.evolution_id AND review.submission_id = s.id
      WHERE e.id = $1 AND ((${origin}) OR (latest.id IS NOT NULL AND ${cross}))
      ORDER BY s.ordinal`, [id, actorId]);
    if (!result.rows.length || result.rows[0].visible_evolution_id === null) throw inaccessible();
    return { evolution_id: id,
      ...(result.rows[0].amendment_of_evolution_id ? { amendment_of_evolution_id: result.rows[0].amendment_of_evolution_id } : {}),
      items: result.rows.filter(row => Boolean(row.id)).map(row => ({
      ...(row.amendment_of_evolution_id ? { amendment_of_evolution_id: row.amendment_of_evolution_id } : {}),
      id: row.id, evolution_id: row.evolution_id, ordinal: row.ordinal, submitted_by: row.submitted_by,
      submitted_at: new Date(row.submitted_at).toISOString(), content: row.content,
      validation_status: row.validation_status,
      ...(row.reviewed_by ? { reviewed_by: row.reviewed_by } : {}),
      ...(row.reviewed_at ? { reviewed_at: new Date(row.reviewed_at).toISOString() } : {}),
    })) };
  }

  async corrections(id: string, actorId: string): Promise<{ evolution_id: string; items: EvolutionCorrection[] }> {
    const result = await this.pool.query<{ evolution_id: string; amendment_of_evolution_id: string | null; submission_id: string | null; reason: string | null; reviewed_by: string | null; requested_at: Date | string | null }>(`SELECT e.id::text AS evolution_id,
      amendment.original_evolution_id::text AS amendment_of_evolution_id,
      correction.submission_id::text AS submission_id, correction.reason, correction.reviewed_by, correction.requested_at
      FROM kinesiology_evolutions e
      LEFT JOIN kinesiology_evolution_amendment_links amendment ON amendment.amendment_evolution_id = e.id
      LEFT JOIN kinesiology_evolution_correction_requests correction ON correction.evolution_id = e.id
      WHERE e.id = $1 AND (${originRead('$2')}) ORDER BY correction.id`, [id, actorId]);
    if (!result.rows.length) throw inaccessible();
    return { evolution_id: result.rows[0].evolution_id,
      ...(result.rows[0].amendment_of_evolution_id ? { amendment_of_evolution_id: result.rows[0].amendment_of_evolution_id } : {}),
      items: result.rows.filter(row => row.submission_id !== null).map(row => ({
      submission_id: row.submission_id!, reason: row.reason!, reviewed_by: row.reviewed_by!,
      requested_at: new Date(row.requested_at!).toISOString(),
    })) };
  }

  private async lockDocument(db: Queryable, row: EvolutionView) {
    const patient = await db.query('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [row.patient_id]);
    if (!patient.rows.length) throw inaccessible();
  }
  private sameIdentity(current: EvolutionView | null, hint: EvolutionView) {
    return !!current && current.id === hint.id && current.author_id === hint.author_id && current.patient_id === hint.patient_id &&
      current.clinical_record_id === hint.clinical_record_id && current.evaluation_id === hint.evaluation_id &&
      current.origin_student_habilitation_id === hint.origin_student_habilitation_id && current.origin_subject_id === hint.origin_subject_id && current.origin_group_id === hint.origin_group_id;
  }
  async detail(id: string, actorId: string): Promise<EvolutionView> {
    const result = await this.pool.query<EvolutionView>(`SELECT ${documentColumns}
      FROM kinesiology_evolutions e ${latestSubmissionJoin}
      WHERE e.id = $1 AND ${this.readCondition('$2')}`, [id, actorId]);
    if (!result.rows.length) throw inaccessible();
    return result.rows[0];
  }

  async list(patientId: string, actorId: string, subjectId?: string, groupId?: string): Promise<EvolutionView[]> {
    const filters = [patientId, actorId];
    let contextFilter = '';
    if (subjectId) { filters.push(subjectId); contextFilter += ` AND e.origin_subject_id = $${filters.length}`; }
    if (groupId) { filters.push(groupId); contextFilter += ` AND e.origin_group_id = $${filters.length}`; }
    const result = await this.pool.query<EvolutionView>(`SELECT ${documentColumns}
      FROM kinesiology_evolutions e ${latestSubmissionJoin}
      WHERE e.patient_id = $1 AND ${this.readCondition('$2')}${contextFilter}
      ORDER BY CASE WHEN (${originRead('$2')}) THEN e.created_at ELSE latest.submitted_at END, e.id`, filters);
    return result.rows;
  }

  private readCondition(actor: string) {
    return `((${originRead(actor)}) OR (latest.id IS NOT NULL AND ${crossContextRead(actor)}))`;
  }

  private find(db: Queryable, id: string, lock = false) {
    return db.query<EvolutionView>(`SELECT ${columns} FROM kinesiology_evolutions WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]).then(result => result.rows[0] ?? null);
  }
  private async canRead(db: Queryable, id: string, actor: string) {
    return (await db.query<{ id: string }>(`SELECT e.id FROM kinesiology_evolutions e WHERE e.id = $1 AND (${originRead('$2')})`, [id, actor])).rows.length > 0;
  }
  private async lockStudent(db: Queryable, actor: string, row: EvolutionView) {
    const student = await db.query<{ id: string }>('SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [actor]);
    if (!student.rows.length) return [];
    return (await db.query<{ id: string }>(`SELECT id FROM student_academic_habilitations WHERE student_id = $1
      AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL ORDER BY id FOR UPDATE`,
      [student.rows[0].id, row.origin_subject_id, row.origin_group_id])).rows.map(period => period.id);
  }
  private async activeAssignments(db: Queryable, patient: string, actor: string, subject: string, group: string) {
    const result = await db.query<{ student_habilitation_id: string }>(`SELECT a.student_habilitation_id
      FROM patient_assignments a
      JOIN student_academic_habilitations sp ON sp.id = a.student_habilitation_id
      JOIN students s ON s.id = sp.student_id
      WHERE a.patient_id = $1 AND s.user_id = $2 AND sp.subject_id = $3 AND sp.academic_group_id = $4
        AND a.subject_id = sp.subject_id AND sp.revoked_at IS NULL AND a.ended_at IS NULL
      ORDER BY a.id FOR UPDATE OF a`, [patient, actor, subject, group]);
    return result.rows;
  }
}
