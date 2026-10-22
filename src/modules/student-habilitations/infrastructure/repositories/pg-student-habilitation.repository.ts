import type { Queryable, UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { StudentHabilitation } from '../../domain/student-habilitation.entity.js';
import type { StudentHabilitationRepositoryPort } from '../../application/student-habilitation.ports.js';

interface PeriodRow {
  id: string;
  student_id: string;
  subject_id: string;
  academic_group_id: string;
  activated_by: string;
  activated_at: Date | string;
  revoked_by: string | null;
  revoked_at: Date | string | null;
}

interface DbError extends Error {
  code?: string;
  constraint?: string;
}

const COLUMNS =
  'id, student_id, subject_id, academic_group_id, activated_by, activated_at, revoked_by, revoked_at';

export class PgStudentHabilitationRepository implements StudentHabilitationRepositoryPort {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly queryable?: Queryable) {}

  async list(input: { studentId?: string; subjectId?: string; academicGroupId?: string; status?: 'active' | 'revoked'; limit: number; offset: number; actorId: string | null; isAdmin: boolean }) {
    const queryable = this.queryable;
    if (!queryable) throw new Error('a queryable is required to list student habilitations');
    let teacherId: string | undefined;
    if (!input.isAdmin) {
      const { rows: contexts } = await queryable.query<{ teacher_id: string; subject_id: string; academic_group_id: string }>(
        `SELECT t.id AS teacher_id, th.subject_id, th.academic_group_id
           FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
          WHERE t.user_id = $1 AND th.revoked_at IS NULL`, [input.actorId],
      );
      const authorized = contexts.filter((context) =>
        (input.subjectId === undefined || context.subject_id === input.subjectId)
        && (input.academicGroupId === undefined || context.academic_group_id === input.academicGroupId));
      if (!authorized.length) throw new ForbiddenError('an active teacher context is required');
      teacherId = contexts[0].teacher_id;
    }

    const values: unknown[] = [];
    const where: string[] = [];
    for (const [column, value] of [['student_id', input.studentId], ['subject_id', input.subjectId], ['academic_group_id', input.academicGroupId]] as const) {
      if (value !== undefined) { values.push(value); where.push(`${column} = $${values.length}`); }
    }
    if (input.status === 'active') where.push('revoked_at IS NULL');
    if (input.status === 'revoked') where.push('revoked_at IS NOT NULL');
    if (teacherId !== undefined) {
      values.push(teacherId);
      where.push(`EXISTS (SELECT 1 FROM teacher_academic_habilitations scope
        WHERE scope.teacher_id = $${values.length} AND scope.subject_id = student_academic_habilitations.subject_id
          AND scope.academic_group_id = student_academic_habilitations.academic_group_id AND scope.revoked_at IS NULL)`);
    }
    values.push(input.limit, input.offset);
    const { rows } = await queryable.query<PeriodRow>(
      `SELECT ${COLUMNS} FROM student_academic_habilitations
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY activated_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return rows.map((row) => ({ id: row.id, studentId: row.student_id, subjectId: row.subject_id, academicGroupId: row.academic_group_id,
      activatedBy: row.activated_by, activatedAt: row.activated_at, revokedBy: row.revoked_by, revokedAt: row.revoked_at }));
  }

  async revoke(input: { id: string; revokedBy: string }): Promise<StudentHabilitation> {
    return this.unitOfWork.withTransaction(async (client) => {
      const { rows: teachers } = await client.query<{ id: string }>(
        'SELECT id FROM teachers WHERE user_id = $1 FOR KEY SHARE', [input.revokedBy],
      );
      if (!teachers.length) throw new ForbiddenError('an active teacher context is required');

      // Keep the shared lock order: teacher contexts -> exact student period -> patients -> assignments.
      // Joining through the target period means a missing/foreign context is denied before period disclosure.
      const { rows: contexts } = await client.query<{ id: string }>(
        `SELECT th.id
           FROM teacher_academic_habilitations th
           JOIN student_academic_habilitations target
             ON target.subject_id = th.subject_id AND target.academic_group_id = th.academic_group_id
          WHERE target.id = $1 AND th.teacher_id = $2 AND th.revoked_at IS NULL
          ORDER BY th.id FOR UPDATE OF th`,
        [input.id, teachers[0].id],
      );
      if (!contexts.length) throw new ForbiddenError('an active teacher context is required');

      const { rows: periods } = await client.query<PeriodRow>(
        `SELECT ${COLUMNS} FROM student_academic_habilitations WHERE id = $1 FOR UPDATE`, [input.id],
      );
      const period = periods[0];
      if (!period) throw new NotFoundError('student habilitation period was not found');

      // A repeated revoke is an audit-preserving read, not another cascade over old history.
      if (period.revoked_at === null) {
        const { rows: patients } = await client.query<{ patient_id: string }>(
          `SELECT DISTINCT patient_id FROM patient_assignments
            WHERE student_habilitation_id = $1 AND ended_at IS NULL
            ORDER BY patient_id`, [input.id],
        );
        const patientIds = patients.map(row => row.patient_id);
        if (patientIds.length) {
          await client.query('SELECT id FROM patients WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [patientIds]);
          await client.query(
            `SELECT id FROM patient_assignments
              WHERE student_habilitation_id = $1 AND ended_at IS NULL
              ORDER BY id FOR UPDATE`, [input.id],
          );
          await client.query(
            `UPDATE patient_assignments SET ended_by = $2, ended_at = clock_timestamp()
              WHERE student_habilitation_id = $1 AND ended_at IS NULL`, [input.id, input.revokedBy],
          );
        }
        const { rows: updated } = await client.query<PeriodRow>(
          `UPDATE student_academic_habilitations
              SET revoked_by = $2,
                  revoked_at = GREATEST(clock_timestamp(), activated_at)
            WHERE id = $1 AND revoked_at IS NULL
            RETURNING ${COLUMNS}`,
          [input.id, input.revokedBy],
        );
        return fromRow(updated[0]);
      }
      return fromRow(period);
    });
  }

  async activate(input: {
    studentId: string;
    subjectId: string;
    academicGroupId: string;
    activatedBy: string;
  }): Promise<StudentHabilitation> {
    try {
      return await this.unitOfWork.withTransaction(async (client) => {
        const { rows: teachers } = await client.query<{ id: string }>(
          'SELECT id FROM teachers WHERE user_id = $1 FOR KEY SHARE',
          [input.activatedBy],
        );
        if (!teachers.length) {
          throw new ForbiddenError('an active teacher context is required');
        }

        // The row lock serializes activation with teacher-period revocation.
        const { rows: contexts } = await client.query<{ id: string }>(
          `SELECT id FROM teacher_academic_habilitations
            WHERE teacher_id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
            FOR UPDATE`,
          [teachers[0].id, input.subjectId, input.academicGroupId],
        );
        if (!contexts.length) {
          throw new ForbiddenError('an active teacher context is required');
        }

        // Do not disclose target existence until contextual authorization passed.
        const { rows: students } = await client.query<{ id: string }>(
          'SELECT id FROM students WHERE id = $1 FOR KEY SHARE',
          [input.studentId],
        );
        if (!students.length) {
          throw new NotFoundError('student was not found');
        }

        const { rows } = await client.query<PeriodRow>(
          `INSERT INTO student_academic_habilitations
             (student_id, subject_id, academic_group_id, activated_by, activated_at)
           VALUES ($1, $2, $3, $4, clock_timestamp())
           RETURNING ${COLUMNS}`,
          [input.studentId, input.subjectId, input.academicGroupId, input.activatedBy],
        );
        return fromRow(rows[0]);
      });
    } catch (error) {
      if (error instanceof Error) {
        const dbError = error as DbError;
        if (
          dbError.code === '23505'
          && dbError.constraint === 'student_habilitations_one_active_context'
        ) {
          throw new ConflictError('student is already active in this subject and academic group');
        }
        if (
          dbError.code === '23503'
          && [
            'student_academic_habilitations_student_id_fkey',
            'student_habilitations_context_fk',
          ].includes(dbError.constraint ?? '')
        ) {
          throw new NotFoundError('student or subject/group context was not found');
        }
      }
      throw error;
    }
  }
}

function fromRow(row: PeriodRow): StudentHabilitation {
  return new StudentHabilitation({
    id: row.id,
    studentId: row.student_id,
    subjectId: row.subject_id,
    academicGroupId: row.academic_group_id,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at,
    revokedBy: row.revoked_by,
    revokedAt: row.revoked_at,
  });
}
