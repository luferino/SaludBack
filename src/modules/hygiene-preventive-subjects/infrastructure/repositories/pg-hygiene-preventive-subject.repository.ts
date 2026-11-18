import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { HygienePreventiveSubjectLink, HygienePreventiveSubjectRepositoryPort } from '../../application/subject-link.ports.js';

export class PgHygienePreventiveSubjectRepository implements HygienePreventiveSubjectRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async add(subjectId: string, actorId: string): Promise<HygienePreventiveSubjectLink> {
    try {
      const result = await this.pool.query<HygienePreventiveSubjectLink>(
        `INSERT INTO hygiene_preventive_subjects (subject_id, career_id, created_by)
         SELECT s.id, s.career_id, $2 FROM subjects s JOIN careers c ON c.id = s.career_id
         WHERE s.id = $1 AND c.code = 'odontology'
         RETURNING subject_id, career_id, created_by, created_at`, [subjectId, actorId],
      );
      if (!result.rows.length) throw new NotFoundError('odontology subject was not found');
      return result.rows[0];
    } catch (error) {
      const failure = error as { code?: string; constraint?: string };
      if (failure.code === '23505' && failure.constraint === 'hygiene_preventive_subjects_pkey') {
        throw new ConflictError('subject is already enabled for hygiene and preventive dentistry');
      }
      throw error;
    }
  }

  async list(): Promise<HygienePreventiveSubjectLink[]> {
    const result = await this.pool.query<HygienePreventiveSubjectLink>(
      'SELECT subject_id, career_id, created_by, created_at FROM hygiene_preventive_subjects ORDER BY subject_id',
    );
    return result.rows;
  }
}
