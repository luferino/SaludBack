import type { UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
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
  constructor(private readonly unitOfWork: UnitOfWorkPort) {}

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
