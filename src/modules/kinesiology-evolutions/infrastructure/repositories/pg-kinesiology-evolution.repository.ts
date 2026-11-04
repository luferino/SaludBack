import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { ForbiddenError, NotFoundError, ConflictError } from '../../../shared/domain/errors.js';
import type { EvolutionRepositoryPort, EvolutionView } from '../../application/evolution.ports.js';
import { validateEvolutionSubmission, type EvolutionContent } from '../../domain/evolution.js';

const columns = `id::text AS id, clinical_record_id::text AS clinical_record_id, evaluation_id::text AS evaluation_id,
 patient_id, author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id, content, status, created_at, updated_at`;
function documentColumns(actor: string): string {
  return `e.id::text AS id, e.clinical_record_id::text AS clinical_record_id, e.evaluation_id::text AS evaluation_id,
    e.patient_id, e.author_id, e.origin_student_habilitation_id, e.origin_subject_id, e.origin_group_id,
    CASE WHEN e.status = 'draft' OR latest.id IS NULL THEN e.content ELSE latest.clinical_content END AS content, e.status,
    latest.id::text AS projected_submission_id, latest.submitted_by::text AS projected_submitted_by,
    latest.submitted_at AS projected_submitted_at,
    CASE WHEN e.status = 'validated' THEN 'validated' WHEN e.status = 'submitted' THEN 'pending_validation' END AS validation_status,
    CASE WHEN (${originRead(actor)}) THEN e.created_at ELSE latest.submitted_at END AS created_at,
    CASE WHEN (${originRead(actor)}) THEN e.updated_at ELSE latest.submitted_at END AS updated_at`;
}
const latestSubmissionJoin = `LEFT JOIN LATERAL (
  SELECT s.id, s.clinical_content, s.submitted_by, s.submitted_at
  FROM kinesiology_evolution_submissions s WHERE s.evolution_id = e.id
  ORDER BY s.ordinal DESC LIMIT 1
) latest ON true`;
const inaccessible = () => new NotFoundError('evolution was not found');

function originRead(actor: string): string {
  return `(e.author_id = ${actor} AND EXISTS (
    SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
    JOIN patient_assignments a ON a.student_habilitation_id = sp.id
    WHERE s.user_id = ${actor} AND a.patient_id = e.patient_id AND a.subject_id = sp.subject_id
      AND sp.subject_id = e.origin_subject_id AND sp.academic_group_id = e.origin_group_id
      AND sp.revoked_at IS NULL AND a.ended_at IS NULL
  )) OR EXISTS (
    SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
    WHERE t.user_id = ${actor} AND th.subject_id = e.origin_subject_id
      AND th.academic_group_id = e.origin_group_id AND th.revoked_at IS NULL
  )`;
}

function crossContextRead(actor: string): string {
  return `((${originRead(actor)}) OR (e.status = 'submitted' AND (
    EXISTS (SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
      JOIN patient_assignments a ON a.student_habilitation_id = sp.id
      WHERE s.user_id = ${actor} AND a.patient_id = e.patient_id AND a.subject_id = sp.subject_id
        AND sp.revoked_at IS NULL AND a.ended_at IS NULL)
    OR EXISTS (SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
      WHERE t.user_id = ${actor} AND th.revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM student_academic_habilitations sp JOIN patient_assignments a ON a.student_habilitation_id = sp.id
          WHERE a.patient_id = e.patient_id AND a.subject_id = th.subject_id AND sp.subject_id = th.subject_id
            AND sp.academic_group_id = th.academic_group_id AND sp.revoked_at IS NULL AND a.ended_at IS NULL))
  )))`;
}

function readCondition(actor: string): string {
  return `(${crossContextRead(actor)})`;
}

export class PgKinesiologyEvolutionRepository implements EvolutionRepositoryPort {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  async create(input: { evaluationId: string; patientId: string; subjectId: string; groupId: string; content: EvolutionContent; actorId: string }): Promise<EvolutionView> {
    return this.unitOfWork.withTransaction(async db => {
      const student = await db.query<{ id: string }>('SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [input.actorId]);
      if (!student.rows.length) throw new ForbiddenError('an active student context is required');
      const periods = await db.query<{ id: string }>(`SELECT id FROM student_academic_habilitations
        WHERE student_id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL ORDER BY id FOR UPDATE`,
      [student.rows[0].id, input.subjectId, input.groupId]);
      if (!periods.rows.length) throw new ForbiddenError('an active student context is required');
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [input.patientId]);
      if (!patient.rows.length) throw new NotFoundError('patient was not found');
      const assignments = await db.query<{ id: string; student_habilitation_id: string }>(`SELECT a.id::text AS id, a.student_habilitation_id
        FROM patient_assignments a JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
        WHERE a.patient_id = $1 AND a.subject_id = $2 AND p.academic_group_id = $3 AND p.student_id = $4
          AND p.subject_id = a.subject_id AND p.revoked_at IS NULL AND a.ended_at IS NULL
        ORDER BY a.id FOR UPDATE OF a`, [input.patientId, input.subjectId, input.groupId, student.rows[0].id]);
      const assignment = assignments.rows.find(row => periods.rows.some(period => period.id === row.student_habilitation_id));
      if (!assignment) throw new NotFoundError('patient was not found');
      const evaluation = await db.query<{ id: string; clinical_record_id: string; patient_id: string; status: string }>(
        `SELECT e.id::text AS id, e.clinical_record_id::text AS clinical_record_id, e.patient_id, e.status
         FROM kinesiology_evaluations e WHERE e.id = $1 AND e.patient_id = $2 AND e.status = 'validated'
           AND (${parentRead('$3')}) FOR UPDATE OF e`, [input.evaluationId, input.patientId, input.actorId]);
      if (!evaluation.rows.length) throw inaccessible();
      const record = await db.query<{ id: string }>('SELECT id::text AS id FROM clinical_records WHERE id = $1 AND patient_id = $2',
        [evaluation.rows[0].clinical_record_id, input.patientId]);
      if (!record.rows.length) throw inaccessible();
      const inserted = await db.query<EvolutionView>(`INSERT INTO kinesiology_evolutions
        (clinical_record_id, patient_id, evaluation_id, author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id, content, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'draft') RETURNING ${columns}`,
      [record.rows[0].id, input.patientId, input.evaluationId, input.actorId, assignment.student_habilitation_id,
        input.subjectId, input.groupId, JSON.stringify(input.content)]);
      return inserted.rows[0];
    });
  }

  async edit(id: string, content: EvolutionContent, actorId: string): Promise<EvolutionView> {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.find(db, id);
      if (!hint || !(await this.canRead(db, id, actorId))) throw inaccessible();
      if (hint.author_id !== actorId) throw new ForbiddenError('only the evolution author can edit it');
      const periods = await this.lockStudent(db, actorId, hint);
      if (!periods.length) throw inaccessible();
      await this.lockPatient(db, hint.patient_id);
      const assignments = await this.activeAssignments(db, hint.patient_id, actorId, hint.origin_subject_id, hint.origin_group_id);
      if (!assignments.some(item => periods.includes(item.student_habilitation_id))) throw inaccessible();
      const locked = await this.find(db, id, true);
      if (!this.sameIdentity(locked, hint) || locked.author_id !== actorId) throw inaccessible();
      if (locked.status !== 'draft') throw new ConflictError('evolution is not an editable draft');
      const result = await db.query<EvolutionView>(`UPDATE kinesiology_evolutions SET content = $2::jsonb, updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'draft' RETURNING ${columns}`, [id, JSON.stringify(content)]);
      if (!result.rows.length) throw new ConflictError('evolution is not an editable draft');
      return result.rows[0];
    });
  }

  async submit(id: string, actorId: string) {
    return this.unitOfWork.withTransaction(async db => {
      const hint = await this.find(db, id);
      if (!hint || hint.author_id !== actorId) throw inaccessible();
      const periods = await this.lockStudent(db, actorId, hint);
      if (!periods.length) throw inaccessible();
      await this.lockPatient(db, hint.patient_id);
      const assignments = await this.activeAssignments(db, hint.patient_id, actorId, hint.origin_subject_id, hint.origin_group_id);
      if (!assignments.some(item => periods.includes(item.student_habilitation_id))) throw inaccessible();
      const locked = await this.find(db, id, true);
      if (!this.sameIdentity(locked, hint) || locked.author_id !== actorId) throw inaccessible();
      if (locked.status !== 'draft') throw new ConflictError('evolution is not an editable draft');
      const content = validateEvolutionSubmission(locked.content);
      const inserted = await db.query<{ id: string; evolution_id: string; ordinal: string; submitted_by: string; submitted_at: Date | string; content: EvolutionContent }>(
        `INSERT INTO kinesiology_evolution_submissions (evolution_id, ordinal, submitted_by, clinical_content)
         SELECT $1, (COALESCE(MAX(ordinal), 0) + 1)::integer, $2, $3::jsonb
         FROM kinesiology_evolution_submissions WHERE evolution_id = $1
         RETURNING id::text AS id, evolution_id::text AS evolution_id, ordinal::text AS ordinal,
           submitted_by::text AS submitted_by, submitted_at, clinical_content AS content`,
        [id, actorId, JSON.stringify(content)]);
      if (!inserted.rows.length) throw new ConflictError('evolution submission could not be created');
      const updated = await db.query(`UPDATE kinesiology_evolutions SET status = 'submitted', updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'draft' AND author_id = $2 RETURNING id`, [id, actorId]);
      if (!updated.rows.length) throw new ConflictError('evolution is not an editable draft');
      const snapshot = inserted.rows[0];
      return { ...snapshot, submitted_at: new Date(snapshot.submitted_at).toISOString(), validation_status: 'pending_validation' as const };
    });
  }

  async submissions(id: string, actorId: string) {
    const result = await this.pool.query<{ evolution_id: string; id: string; ordinal: string; submitted_by: string; submitted_at: Date | string; content: EvolutionContent; validation_status: 'pending_validation' | 'validated' }>(
      `SELECT e.id::text AS evolution_id, s.id::text AS id, s.ordinal::text AS ordinal, s.submitted_by::text AS submitted_by,
        s.submitted_at, s.clinical_content AS content,
        CASE WHEN vr.submission_id IS NULL THEN 'pending_validation' ELSE 'validated' END AS validation_status
       FROM kinesiology_evolutions e JOIN kinesiology_evolution_submissions s ON s.evolution_id = e.id
       LEFT JOIN kinesiology_evolution_validation_reviews vr ON vr.submission_id = s.id
       WHERE e.id = $1 AND ${readCondition('$2')}
         AND ((${originRead('$2')}) OR s.id = (SELECT latest_submission.id FROM kinesiology_evolution_submissions latest_submission
           WHERE latest_submission.evolution_id = e.id ORDER BY latest_submission.ordinal DESC LIMIT 1))
       ORDER BY s.ordinal`, [id, actorId]);
    if (!result.rows.length) {
      const exists = await this.pool.query(`SELECT e.id FROM kinesiology_evolutions e WHERE e.id = $1 AND ${readCondition('$2')}`, [id, actorId]);
      if (!exists.rows.length) throw inaccessible();
    }
    return { evolution_id: id, items: result.rows.map(row => ({
      ...row, submitted_at: new Date(row.submitted_at).toISOString(),
    })) };
  }

  async detail(id: string, actorId: string): Promise<EvolutionView> {
    const result = await this.pool.query<EvolutionView>(`SELECT ${documentColumns('$2')} FROM kinesiology_evolutions e ${latestSubmissionJoin}
      WHERE e.id = $1 AND ${readCondition('$2')}`, [id, actorId]);
    if (!result.rows.length) throw inaccessible();
    return result.rows[0];
  }

  async list(patientId: string, actorId: string, subjectId?: string, groupId?: string): Promise<EvolutionView[]> {
    const params: unknown[] = [patientId, actorId];
    const filters = ['e.patient_id = $1', readCondition('$2')];
    if (subjectId) { params.push(subjectId); filters.push(`e.origin_subject_id = $${params.length}`); }
    if (groupId) { params.push(groupId); filters.push(`e.origin_group_id = $${params.length}`); }
    const result = await this.pool.query<EvolutionView>(`SELECT ${documentColumns('$2')} FROM kinesiology_evolutions e ${latestSubmissionJoin}
      WHERE ${filters.join(' AND ')} ORDER BY e.id`, params);
    return result.rows;
  }

  private async canRead(db: Queryable, id: string, actor: string) {
    const result = await db.query<{ id: string }>(`SELECT e.id FROM kinesiology_evolutions e WHERE e.id = $1 AND (${originRead('$2')})`, [id, actor]);
    return result.rows.length > 0;
  }

  private find(db: Queryable, id: string, lock = false) {
    return db.query<EvolutionView>(`SELECT ${columns} FROM kinesiology_evolutions WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
      .then(result => result.rows[0] ?? null);
  }
  private async lockStudent(db: Queryable, actor: string, row: EvolutionView) {
    const student = await db.query<{ id: string }>('SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [actor]);
    if (!student.rows.length) return [];
    const periods = await db.query<{ id: string }>(`SELECT id FROM student_academic_habilitations WHERE student_id = $1
      AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL ORDER BY id FOR UPDATE`,
    [student.rows[0].id, row.origin_subject_id, row.origin_group_id]);
    return periods.rows.map(period => period.id);
  }
  private async lockPatient(db: Queryable, patientId: string) {
    const patient = await db.query('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [patientId]);
    if (!patient.rows.length) throw inaccessible();
  }
  private async activeAssignments(db: Queryable, patient: string, actor: string, subject: string, group: string) {
    const result = await db.query<{ student_habilitation_id: string }>(`SELECT a.student_habilitation_id FROM patient_assignments a
      JOIN student_academic_habilitations sp ON sp.id = a.student_habilitation_id JOIN students s ON s.id = sp.student_id
      WHERE a.patient_id = $1 AND s.user_id = $2 AND sp.subject_id = $3 AND sp.academic_group_id = $4
        AND a.subject_id = sp.subject_id AND sp.revoked_at IS NULL AND a.ended_at IS NULL ORDER BY a.id FOR UPDATE OF a`,
    [patient, actor, subject, group]);
    return result.rows;
  }
  private sameIdentity(current: EvolutionView | null, hint: EvolutionView) {
    return !!current && current.id === hint.id && current.author_id === hint.author_id && current.patient_id === hint.patient_id &&
      current.clinical_record_id === hint.clinical_record_id && current.evaluation_id === hint.evaluation_id &&
      current.origin_student_habilitation_id === hint.origin_student_habilitation_id &&
      current.origin_subject_id === hint.origin_subject_id && current.origin_group_id === hint.origin_group_id;
  }
}

function parentRead(actor: string): string {
  return `(EXISTS (SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
    JOIN patient_assignments a ON a.student_habilitation_id = sp.id WHERE s.user_id = ${actor} AND a.patient_id = e.patient_id
      AND a.subject_id = sp.subject_id AND sp.revoked_at IS NULL AND a.ended_at IS NULL)
    OR EXISTS (SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
      WHERE t.user_id = ${actor} AND th.subject_id = e.origin_subject_id AND th.academic_group_id = e.origin_group_id AND th.revoked_at IS NULL))`;
}
