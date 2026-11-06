import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { OralSurgerySubjectContext, OralSurgerySubjectLink, OralSurgerySubjectRepositoryPort } from '../../application/subject-link.ports.js';

export class PgOralSurgerySubjectRepository implements OralSurgerySubjectRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async add(subjectId: string, actorId: string): Promise<OralSurgerySubjectLink> {
    try {
      const result = await this.pool.query<OralSurgerySubjectLink>(
        `INSERT INTO oral_surgery_subjects (subject_id, career_id, created_by)
         SELECT s.id, s.career_id, $2 FROM subjects s JOIN careers c ON c.id = s.career_id
         WHERE s.id = $1 AND c.code = 'odontology'
         RETURNING subject_id, career_id, created_by, created_at`, [subjectId, actorId],
      );
      if (!result.rows.length) throw new NotFoundError('odontology subject was not found');
      return result.rows[0];
    } catch (error) {
      const failure = error as { code?: string; constraint?: string };
      if (failure.code === '23505' && failure.constraint === 'oral_surgery_subjects_pkey') {
        throw new ConflictError('subject is already enabled for oral surgery');
      }
      throw error;
    }
  }

  async list(): Promise<OralSurgerySubjectLink[]> {
    const result = await this.pool.query<OralSurgerySubjectLink>(
      'SELECT subject_id, career_id, created_by, created_at FROM oral_surgery_subjects ORDER BY subject_id',
    );
    return result.rows;
  }

  async listMine(actorId: string, role: 'estudiante' | 'teacher'): Promise<OralSurgerySubjectContext[]> {
    const result = await this.pool.query<OralSurgerySubjectContext>(
      `SELECT DISTINCT link.subject_id::text AS subject_id, contexts.academic_group_id::text AS academic_group_id
       FROM oral_surgery_subjects link
       JOIN (
         SELECT h.subject_id, h.academic_group_id
         FROM student_academic_habilitations h
         JOIN students s ON s.id = h.student_id
         WHERE s.user_id = $1 AND $2 = 'estudiante' AND h.revoked_at IS NULL
         UNION ALL
         SELECT h.subject_id, h.academic_group_id
         FROM teacher_academic_habilitations h
         JOIN teachers t ON t.id = h.teacher_id
         WHERE t.user_id = $1 AND $2 = 'teacher' AND h.revoked_at IS NULL
       ) contexts ON contexts.subject_id = link.subject_id
       ORDER BY subject_id, academic_group_id`,
      [actorId, role],
    );
    return result.rows;
  }
}
