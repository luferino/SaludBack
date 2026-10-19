import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import { TeacherHabilitation } from '../../domain/teacher-habilitation.entity.js';
import type { TeacherHabilitationRepositoryPort } from '../../application/teacher-habilitation.ports.js';

interface TeacherHabilitationRow {
  id: string;
  teacher_id: string;
  subject_id: string;
  academic_group_id: string;
  activated_by: string;
  activated_at: Date | string;
  revoked_by: string | null;
  revoked_at: Date | string | null;
}

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
}

const COLUMNS = 'id, teacher_id, subject_id, academic_group_id, activated_by, activated_at, revoked_by, revoked_at';
const ACTIVE_CONTEXT_INDEX = 'teacher_habilitations_one_active_context';
const TEACHER_FOREIGN_KEY = 'teacher_academic_habilitations_teacher_id_fkey';
const CONTEXT_FOREIGN_KEY = 'teacher_habilitations_context_fk';

export class PgTeacherHabilitationRepository implements TeacherHabilitationRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async activate(input: {
    teacherId: string;
    subjectId: string;
    academicGroupId: string;
    activatedBy: string;
  }): Promise<TeacherHabilitation> {
    try {
      const { rows } = await this.pool.query<TeacherHabilitationRow>(
        `INSERT INTO teacher_academic_habilitations
           (teacher_id, subject_id, academic_group_id, activated_by, activated_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())
         RETURNING ${COLUMNS}`,
        [input.teacherId, input.subjectId, input.academicGroupId, input.activatedBy],
      );
      return rowToTeacherHabilitation(rows[0]);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const databaseError = error as DatabaseError;
      if (databaseError.code === '23505' && databaseError.constraint === ACTIVE_CONTEXT_INDEX) {
        throw new ConflictError('teacher is already active in this subject and academic group');
      }
      if (databaseError.code === '23503'
        && [TEACHER_FOREIGN_KEY, CONTEXT_FOREIGN_KEY].includes(databaseError.constraint ?? '')) {
        throw new NotFoundError('teacher, subject, or academic group context was not found');
      }
      throw error;
    }
  }
}

function rowToTeacherHabilitation(row: TeacherHabilitationRow): TeacherHabilitation {
  return new TeacherHabilitation({
    id: row.id,
    teacherId: row.teacher_id,
    subjectId: row.subject_id,
    academicGroupId: row.academic_group_id,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at,
    revokedBy: row.revoked_by,
    revokedAt: row.revoked_at,
  });
}
