import type { Pool } from 'pg';
import type { UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Assignment as AssignmentRow, AssignmentInput } from '../../domain/patient-assignment.js';
import { requireActiveAssignment, requireSameSubject } from '../../domain/patient-assignment.js';
import type { PatientAssignmentRepositoryPort } from '../../application/patient-assignment.ports.js';

const LIST_COLUMNS = `
  a.id::text AS id, a.patient_id, a.student_habilitation_id, a.subject_id,
  p.academic_group_id, a.assigned_by, a.assigned_at, a.ended_by, a.ended_at,
  a.end_reason, pt.nombres, pt.apellidos, pt.documento`;

export class PgPatientAssignmentRepository implements PatientAssignmentRepositoryPort {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  async create(input: AssignmentInput): Promise<AssignmentRow> {
    try {
      return await this.unitOfWork.withTransaction(async (db) => {
        const teacher = await db.query<{ id: string }>(
          'SELECT id FROM teachers WHERE user_id = $1 FOR KEY SHARE',
          [input.actorId],
        );
        if (!teacher.rows.length) {
          throw new ForbiddenError('an active teacher context is required');
        }

        // T2/T3/T4 share this teacher -> student-period -> patient lock order.
        const contexts = await db.query<{ id: string }>(
          `SELECT id FROM teacher_academic_habilitations
            WHERE teacher_id = $1 AND subject_id = $2 AND academic_group_id = $3
              AND revoked_at IS NULL
            ORDER BY id FOR UPDATE`,
          [teacher.rows[0].id, input.subjectId, input.groupId],
        );
        if (!contexts.rows.length) {
          throw new ForbiddenError('an active teacher context is required');
        }

        const periods = await db.query<{ id: string; academic_group_id: string }>(
          `SELECT id, academic_group_id FROM student_academic_habilitations
            WHERE id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
            ORDER BY id FOR UPDATE`,
          [input.periodId, input.subjectId, input.groupId],
        );
        if (!periods.rows.length) {
          throw new NotFoundError('active matching student habilitation was not found');
        }

        const patients = await db.query<{ id: string }>(
          'SELECT id FROM patients WHERE id = $1 FOR UPDATE',
          [input.patientId],
        );
        if (!patients.rows.length) {
          throw new NotFoundError('patient was not found');
        }

        const inserted = await db.query<Omit<AssignmentRow, 'academic_group_id'>>(
          `INSERT INTO patient_assignments
             (patient_id, student_habilitation_id, subject_id, assigned_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id::text AS id, patient_id, student_habilitation_id, subject_id,
                     assigned_by, assigned_at, ended_by, ended_at, end_reason`,
          [input.patientId, input.periodId, input.subjectId, input.actorId],
        );
        return { ...inserted.rows[0], academic_group_id: periods.rows[0].academic_group_id };
      });
    } catch (error) {
      const dbError = error as { code?: string; constraint?: string };
      if (dbError.code === '23505' && dbError.constraint === 'patient_assignments_one_active_patient_subject') {
        throw new ConflictError('patient already has an active assignment for this subject');
      }
      if (dbError.code === '23503' && dbError.constraint === 'patient_assignments_period_subject_fk') {
        throw new NotFoundError('active matching student habilitation was not found');
      }
      throw error;
    }
  }

  async reassign(assignmentId: string, input: Omit<AssignmentInput, 'patientId'>): Promise<AssignmentRow> {
    return this.unitOfWork.withTransaction(async (db) => {
      const sourceResult = await db.query<AssignmentRow>(
        `SELECT a.id::text AS id, a.patient_id, a.student_habilitation_id, a.subject_id,
                p.academic_group_id, a.assigned_by, a.assigned_at, a.ended_by, a.ended_at, a.end_reason
           FROM patient_assignments a
           JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
          WHERE a.id = $1`, [assignmentId],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new NotFoundError('assignment was not found');
      const teacher = await db.query<{ id: string }>(
        'SELECT id FROM teachers WHERE user_id = $1 FOR KEY SHARE', [input.actorId],
      );
      if (!teacher.rows.length) throw new ForbiddenError('an active teacher context is required');

      // Match create/T4 ordering: all teacher contexts, periods, patient, then assignment.
      const contexts = await db.query<{ id: string; subject_id: string; academic_group_id: string }>(
        `SELECT id, subject_id, academic_group_id FROM teacher_academic_habilitations
          WHERE teacher_id = $1 AND revoked_at IS NULL
            AND ((subject_id = $2 AND academic_group_id = $3)
              OR (subject_id = $4 AND academic_group_id = $5))
          ORDER BY id FOR UPDATE`,
        [teacher.rows[0].id, source.subject_id, source.academic_group_id, input.subjectId, input.groupId],
      );
      const hasContext = (subject: string, group: string) => contexts.rows.some(
        row => row.subject_id === subject && row.academic_group_id === group,
      );
      if (!hasContext(source.subject_id, source.academic_group_id) || !hasContext(input.subjectId, input.groupId)) {
        throw new ForbiddenError('an active teacher context is required in source and destination groups');
      }
      requireActiveAssignment(source);
      requireSameSubject(source.subject_id, input.subjectId);
      const periods = await db.query<{ id: string; academic_group_id: string }>(
        `SELECT id, academic_group_id FROM student_academic_habilitations
          WHERE id = ANY($1::uuid[]) AND subject_id = $2 AND revoked_at IS NULL
          ORDER BY id FOR UPDATE`,
        [[...new Set([source.student_habilitation_id, input.periodId])].sort(), source.subject_id],
      );
      if (!periods.rows.some(row => row.id === input.periodId && row.academic_group_id === input.groupId)) {
        throw new NotFoundError('active matching student habilitation was not found');
      }
      if (!periods.rows.some(row => row.id === source.student_habilitation_id && row.academic_group_id === source.academic_group_id)) {
        throw new ConflictError('source student habilitation is no longer active');
      }
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [source.patient_id]);
      if (!patient.rows.length) throw new NotFoundError('patient was not found');
      const locked = await db.query<AssignmentRow>(
        `SELECT id::text AS id, patient_id, student_habilitation_id, subject_id, assigned_by, assigned_at,
                ended_by, ended_at, end_reason
           FROM patient_assignments WHERE id = $1 FOR UPDATE`, [assignmentId],
      );
      if (!locked.rows.length) throw new NotFoundError('assignment was not found');
      requireActiveAssignment(locked.rows[0]);
      const closed = await db.query(
        `UPDATE patient_assignments SET ended_by = $2, ended_at = clock_timestamp()
          WHERE id = $1 AND ended_at IS NULL RETURNING id`, [assignmentId, input.actorId],
      );
      if (!closed.rows.length) throw new ConflictError('assignment is already ended');
      const inserted = await db.query<Omit<AssignmentRow, 'academic_group_id'>>(
        `INSERT INTO patient_assignments (patient_id, student_habilitation_id, subject_id, assigned_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id::text AS id, patient_id, student_habilitation_id, subject_id,
                   assigned_by, assigned_at, ended_by, ended_at, end_reason`,
        [source.patient_id, input.periodId, source.subject_id, input.actorId],
      );
      return { ...inserted.rows[0], academic_group_id: input.groupId };
    }).catch((error: unknown) => {
      const dbError = error as { code?: string; constraint?: string };
      if (dbError.code === '23505' && dbError.constraint === 'patient_assignments_one_active_patient_subject') {
        throw new ConflictError('patient already has an active assignment for this subject');
      }
      throw error;
    });
  }

  async end(assignmentId: string, actorId: string, reason: string): Promise<AssignmentRow> {
    return this.unitOfWork.withTransaction(async (db) => {
      const sourceResult = await db.query<AssignmentRow>(
        `SELECT a.id::text AS id, a.patient_id, a.student_habilitation_id, a.subject_id,
                p.academic_group_id, a.assigned_by, a.assigned_at, a.ended_by, a.ended_at, a.end_reason
           FROM patient_assignments a JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
          WHERE a.id = $1`, [assignmentId],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new NotFoundError('assignment was not found');
      const teacher = await db.query<{ id: string }>('SELECT id FROM teachers WHERE user_id = $1 FOR KEY SHARE', [actorId]);
      if (!teacher.rows.length) throw new ForbiddenError('an active teacher context is required');
      const contexts = await db.query<{ id: string }>(
        `SELECT id FROM teacher_academic_habilitations
          WHERE teacher_id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
          ORDER BY id FOR UPDATE`, [teacher.rows[0].id, source.subject_id, source.academic_group_id],
      );
      if (!contexts.rows.length) throw new ForbiddenError('an active teacher context is required');
      requireActiveAssignment(source);
      const periods = await db.query<{ id: string }>(
        `SELECT id FROM student_academic_habilitations
          WHERE id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
          ORDER BY id FOR UPDATE`, [source.student_habilitation_id, source.subject_id, source.academic_group_id],
      );
      if (!periods.rows.length) throw new ConflictError('source student habilitation is no longer active');
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [source.patient_id]);
      if (!patient.rows.length) throw new NotFoundError('patient was not found');
      const updated = await db.query<AssignmentRow>(
        `UPDATE patient_assignments SET ended_by = $2, ended_at = clock_timestamp(), end_reason = $3
          WHERE id = $1 AND ended_at IS NULL
          RETURNING id::text AS id, patient_id, student_habilitation_id, subject_id, assigned_by,
                    assigned_at, ended_by, ended_at, end_reason`, [assignmentId, actorId, reason],
      );
      if (!updated.rows.length) throw new ConflictError('assignment is already ended');
      return { ...updated.rows[0], academic_group_id: source.academic_group_id };
    });
  }

  listTeacher(actor: string, limit: number, offset: number): Promise<AssignmentRow[]> {
    const teacherContext = `EXISTS (
      SELECT 1 FROM teachers t
      JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
      WHERE t.user_id = $1 AND th.subject_id = a.subject_id
        AND th.academic_group_id = p.academic_group_id AND th.revoked_at IS NULL
    )`;
    return this.list(teacherContext, actor, limit, offset);
  }

  listOwn(actor: string, limit: number, offset: number): Promise<AssignmentRow[]> {
    return this.list('p.student_id = (SELECT id FROM students WHERE user_id = $1)', actor, limit, offset);
  }

  private async list(scope: string, actor: string, limit: number, offset: number): Promise<AssignmentRow[]> {
    const { rows } = await this.pool.query<AssignmentRow>(
      `SELECT ${LIST_COLUMNS}
         FROM patient_assignments a
         JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
         JOIN patients pt ON pt.id = a.patient_id
        WHERE a.ended_at IS NULL AND p.revoked_at IS NULL AND ${scope}
        ORDER BY a.id LIMIT $2 OFFSET $3`,
      [actor, limit, offset],
    );
    return rows.map((row) => ({
      ...row,
      assigned_at: new Date(row.assigned_at).toISOString(),
      ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    }));
  }
}
