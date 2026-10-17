import type { Pool } from 'pg';
import { ConflictError } from '../../../shared/domain/errors.js';
import { Group } from '../../domain/group.entity.js';
import type { GroupRepositoryPort } from '../../application/group.ports.js';

interface GroupRow {
  id: string;
  academic_year: number;
  curriculum_semester: number;
  name: string;
  created_by: string | null;
  created_at: Date | string;
}

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
}

const GROUP_COLUMNS = 'id, academic_year, curriculum_semester, name, created_by, created_at';
const GROUP_UNIQUE_CONSTRAINT = 'academic_groups_year_semester_name_unique';

export class PgGroupRepository implements GroupRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(group: Group): Promise<Group> {
    try {
      const { rows } = await this.pool.query<GroupRow>(
        `INSERT INTO academic_groups (academic_year, curriculum_semester, name, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING ${GROUP_COLUMNS}`,
        [group.academicYear, group.curriculumSemester, group.name, group.createdBy],
      );
      return rowToGroup(rows[0]);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const databaseError = error as DatabaseError;
      if (databaseError.code !== '23505' || databaseError.constraint !== GROUP_UNIQUE_CONSTRAINT) {
        throw error;
      }
      throw new ConflictError('group already exists for academic year, semester, and name');
    }
  }

  async list({ limit, offset }: { limit: number; offset: number }): Promise<Group[]> {
    const { rows } = await this.pool.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS}
       FROM academic_groups
       ORDER BY academic_year ASC, curriculum_semester ASC, name ASC, id ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map(rowToGroup);
  }
}

function rowToGroup(row: GroupRow): Group {
  return new Group({
    id: row.id,
    academicYear: row.academic_year,
    curriculumSemester: row.curriculum_semester,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}
