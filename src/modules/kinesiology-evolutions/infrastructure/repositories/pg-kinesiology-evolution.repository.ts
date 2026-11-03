import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { ForbiddenError, NotFoundError, ConflictError } from '../../../shared/domain/errors.js';
import type { EvolutionRepositoryPort, EvolutionView } from '../../application/evolution.ports.js';
import type { EvolutionContent } from '../../domain/evolution.js';

const columns = `id::text AS id, clinical_record_id::text AS clinical_record_id, evaluation_id::text AS evaluation_id,
 patient_id, author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id, content, status, created_at, updated_at`;
const documentColumns = `e.id::text AS id, e.clinical_record_id::text AS clinical_record_id, e.evaluation_id::text AS evaluation_id,
 e.patient_id, e.author_id, e.origin_student_habilitation_id, e.origin_subject_id, e.origin_group_id, e.content, e.status, e.created_at, e.updated_at`;
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

  async detail(id: string, actorId: string): Promise<EvolutionView> {
    const result = await this.pool.query<EvolutionView>(`SELECT ${documentColumns} FROM kinesiology_evolutions e
      WHERE e.id = $1 AND (${originRead('$2')})`, [id, actorId]);
    if (!result.rows.length) throw inaccessible();
    return result.rows[0];
  }

  async list(patientId: string, actorId: string, subjectId?: string, groupId?: string): Promise<EvolutionView[]> {
    const params: unknown[] = [patientId, actorId];
    const filters = ['e.patient_id = $1', `(${originRead('$2')})`];
    if (subjectId) { params.push(subjectId); filters.push(`e.origin_subject_id = $${params.length}`); }
    if (groupId) { params.push(groupId); filters.push(`e.origin_group_id = $${params.length}`); }
    const result = await this.pool.query<EvolutionView>(`SELECT ${documentColumns} FROM kinesiology_evolutions e
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
