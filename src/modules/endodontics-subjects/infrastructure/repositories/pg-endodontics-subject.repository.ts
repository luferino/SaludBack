import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { EndodonticsSubjectLink, EndodonticsSubjectRepositoryPort } from '../../application/subject-link.ports.js';

export class PgEndodonticsSubjectRepository implements EndodonticsSubjectRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async add(subjectId: string, actorId: string): Promise<EndodonticsSubjectLink> {
    try {
      const result = await this.pool.query<EndodonticsSubjectLink>(
        `INSERT INTO endodontics_subjects (subject_id, career_id, created_by)
         SELECT s.id, s.career_id, $2 FROM subjects s JOIN careers c ON c.id = s.career_id
         WHERE s.id = $1 AND c.code = 'odontology'
         RETURNING subject_id, career_id, created_by, created_at`, [subjectId, actorId],
      );
      if (!result.rows.length) throw new NotFoundError('odontology subject was not found');
      return result.rows[0];
    } catch (error) {
      const failure = error as { code?: string; constraint?: string };
      if (failure.code === '23505' && failure.constraint === 'endodontics_subjects_pkey') {
        throw new ConflictError('subject is already enabled for endodontics');
      }
      throw error;
    }
  }

  async list(): Promise<EndodonticsSubjectLink[]> {
    const result = await this.pool.query<EndodonticsSubjectLink>(
      'SELECT subject_id, career_id, created_by, created_at FROM endodontics_subjects ORDER BY subject_id',
    );
    return result.rows;
  }

  async listMine(actorId: string, role: 'estudiante' | 'teacher') {
    const result = role === 'estudiante'
      ? await this.pool.query(`SELECT DISTINCT h.subject_id, h.academic_group_id FROM students s
          JOIN student_academic_habilitations h ON h.student_id=s.id
          JOIN endodontics_subjects e ON e.subject_id=h.subject_id
          WHERE s.user_id=$1 AND h.revoked_at IS NULL ORDER BY h.subject_id,h.academic_group_id`, [actorId])
      : await this.pool.query(`SELECT DISTINCT h.subject_id, h.academic_group_id FROM teachers t
          JOIN teacher_academic_habilitations h ON h.teacher_id=t.id
          JOIN endodontics_subjects e ON e.subject_id=h.subject_id
          WHERE t.user_id=$1 AND h.revoked_at IS NULL ORDER BY h.subject_id,h.academic_group_id`, [actorId]);
    return result.rows;
  }
}
