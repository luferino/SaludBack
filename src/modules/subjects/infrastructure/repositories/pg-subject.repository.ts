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

  async list({ careerId, q, limit, offset }: { careerId?: string; q?: string; limit: number; offset: number }): Promise<Subject[]> {
    const params: Array<string | number> = [];
    const filters: string[] = [];
    if (careerId !== undefined) {
      params.push(careerId);
      filters.push(`career_id = $${params.length}`);
    }
    if (q) {
      params.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%');
      filters.push(`name ILIKE $${params.length}`);
    }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    params.push(limit, offset);
    const query = `SELECT ${SUBJECT_COLUMNS} FROM subjects${where} ORDER BY name ASC, id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;
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
