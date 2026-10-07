import type { Pool } from 'pg';
import { Subject } from '../../domain/subject.entity.js';
import type { SubjectRepositoryPort } from '../../application/subject.ports.js';

interface SubjectRow {
  id: string;
  name: string;
  created_by: string | null;
  created_at: Date | string;
}

const SUBJECT_COLUMNS = 'id, name, created_by, created_at';

export class PgSubjectRepository implements SubjectRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(subject: Subject): Promise<Subject> {
    const { rows } = await this.pool.query<SubjectRow>(
      `INSERT INTO subjects (name, created_by) VALUES ($1, $2) RETURNING ${SUBJECT_COLUMNS}`,
      [subject.name, subject.createdBy],
    );
    return rowToSubject(rows[0]);
  }

  async list({ limit, offset }: { limit: number; offset: number }): Promise<Subject[]> {
    const { rows } = await this.pool.query<SubjectRow>(
      `SELECT ${SUBJECT_COLUMNS} FROM subjects ORDER BY name ASC, id ASC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map(rowToSubject);
  }
}

function rowToSubject(row: SubjectRow): Subject {
  return new Subject({
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}
