import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import { Group } from '../../domain/group.entity.js';
import type { GroupRepositoryPort } from '../../application/group.ports.js';

interface GroupRow {
  id: string;
  academic_year: number;
  curriculum_semester: number;
  name: string;
  career_id: string;
  created_by: string | null;
  created_at: Date | string;
}

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
}

const GROUP_COLUMNS = 'id, academic_year, curriculum_semester, name, career_id, created_by, created_at';
const GROUP_UNIQUE_CONSTRAINT = 'academic_groups_career_year_semester_name_unique';
const GROUP_CAREER_FOREIGN_KEY = 'academic_groups_career_id_fkey';

export class PgGroupRepository implements GroupRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(group: Group): Promise<Group> {
    try {
      const { rows } = await this.pool.query<GroupRow>(
        `INSERT INTO academic_groups (academic_year, curriculum_semester, name, career_id, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${GROUP_COLUMNS}`,
        [group.academicYear, group.curriculumSemester, group.name, group.careerId, group.createdBy],
      );
      return rowToGroup(rows[0]);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const databaseError = error as DatabaseError;
      if (databaseError.code === '23505' && databaseError.constraint === GROUP_UNIQUE_CONSTRAINT) {
        throw new ConflictError('group already exists for career, academic year, semester, and name');
      }
      if (databaseError.code === '23503' && databaseError.constraint === GROUP_CAREER_FOREIGN_KEY) {
        throw new NotFoundError('career was not found');
      }
      throw error;
    }
  }

  async list({ careerId, q, limit, offset }: { careerId?: string; q?: string; limit: number; offset: number }): Promise<Group[]> {
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
    const query = `SELECT ${GROUP_COLUMNS} FROM academic_groups${where}
      ORDER BY academic_year ASC, curriculum_semester ASC, name ASC, id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await this.pool.query<GroupRow>(query, params);
    return rows.map(rowToGroup);
  }
}

function rowToGroup(row: GroupRow): Group {
  return new Group({
    id: row.id,
    academicYear: row.academic_year,
    curriculumSemester: row.curriculum_semester,
    name: row.name,
    careerId: row.career_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}
