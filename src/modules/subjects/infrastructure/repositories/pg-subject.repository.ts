import type { Pool } from 'pg';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { Subject } from '../../domain/subject.entity.js';
import type { SubjectRepositoryPort } from '../../application/subject.ports.js';

interface SubjectRow {
  id: string;
  name: string;
  career_id: string;
  created_by: string | null;
  created_at: Date | string;
}

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
}

const SUBJECT_COLUMNS = 'id, name, career_id, created_by, created_at';
const SUBJECT_CAREER_FOREIGN_KEY = 'subjects_career_id_fkey';

export class PgSubjectRepository implements SubjectRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(subject: Subject): Promise<Subject> {
    try {
      const { rows } = await this.pool.query<SubjectRow>(
        `INSERT INTO subjects (name, career_id, created_by) VALUES ($1, $2, $3) RETURNING ${SUBJECT_COLUMNS}`,
        [subject.name, subject.careerId, subject.createdBy],
      );
      return rowToSubject(rows[0]);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const databaseError = error as DatabaseError;
      if (databaseError.code === '23503' && databaseError.constraint === SUBJECT_CAREER_FOREIGN_KEY) {
        throw new NotFoundError('career was not found');
      }
      throw error;
    }
  }

  async list({ careerId, limit, offset }: { careerId?: string; limit: number; offset: number }): Promise<Subject[]> {
    const query = careerId === undefined
      ? `SELECT ${SUBJECT_COLUMNS} FROM subjects ORDER BY name ASC, id ASC LIMIT $1 OFFSET $2`
      : `SELECT ${SUBJECT_COLUMNS} FROM subjects WHERE career_id = $1 ORDER BY name ASC, id ASC LIMIT $2 OFFSET $3`;
    const params = careerId === undefined ? [limit, offset] : [careerId, limit, offset];
    const { rows } = await this.pool.query<SubjectRow>(query, params);
    return rows.map(rowToSubject);
  }
}

function rowToSubject(row: SubjectRow): Subject {
  return new Subject({
    id: row.id,
    name: row.name,
    careerId: row.career_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}
