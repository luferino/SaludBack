import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import { SubjectGroup } from '../../domain/subject-group.entity.js';
import type { SubjectGroupCareerPair, SubjectGroupRepositoryPort } from '../../application/subject-group.ports.js';

interface SubjectGroupRow {
  subject_id: string;
  academic_group_id: string;
  career_id: string;
  created_by: string | null;
  created_at: Date | string;
}

interface CareerPairRow {
  subject_career_id: string | null;
  academic_group_career_id: string | null;
}

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
}

const SUBJECT_GROUP_COLUMNS = 'subject_id, academic_group_id, career_id, created_by, created_at';
const SUBJECT_GROUP_PRIMARY_KEY = 'subject_academic_groups_pkey';
const SUBJECT_FOREIGN_KEY = 'subject_academic_groups_subject_id_fkey';
const ACADEMIC_GROUP_FOREIGN_KEY = 'subject_academic_groups_academic_group_id_fkey';
const SUBJECT_CAREER_FOREIGN_KEY = 'subject_academic_groups_subject_career_fkey';
const ACADEMIC_GROUP_CAREER_FOREIGN_KEY = 'subject_academic_groups_academic_group_career_fkey';

export class PgSubjectGroupRepository implements SubjectGroupRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findCareerPair({ subjectId, academicGroupId }: { subjectId: string; academicGroupId: string }): Promise<SubjectGroupCareerPair> {
    const { rows } = await this.pool.query<CareerPairRow>(
      `SELECT (SELECT career_id FROM subjects WHERE id = $1) AS subject_career_id,
              (SELECT career_id FROM academic_groups WHERE id = $2) AS academic_group_career_id`,
      [subjectId, academicGroupId],
    );
    return {
      subjectCareerId: rows[0].subject_career_id,
      academicGroupCareerId: rows[0].academic_group_career_id,
    };
  }

  async create(subjectGroup: SubjectGroup): Promise<SubjectGroup> {
    try {
      const { rows } = await this.pool.query<SubjectGroupRow>(
        `INSERT INTO subject_academic_groups (subject_id, academic_group_id, career_id, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SUBJECT_GROUP_COLUMNS}`,
        [subjectGroup.subjectId, subjectGroup.academicGroupId, subjectGroup.careerId, subjectGroup.createdBy],
      );
      return rowToSubjectGroup(rows[0]);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const databaseError = error as DatabaseError;
      if (databaseError.code === '23505' && databaseError.constraint === SUBJECT_GROUP_PRIMARY_KEY) {
        throw new ConflictError('subject is already associated with academic group');
      }
      if (databaseError.code === '23503'
        && [
          SUBJECT_FOREIGN_KEY,
          ACADEMIC_GROUP_FOREIGN_KEY,
          SUBJECT_CAREER_FOREIGN_KEY,
          ACADEMIC_GROUP_CAREER_FOREIGN_KEY,
        ].includes(databaseError.constraint ?? '')) {
        throw new NotFoundError('subject or academic group was not found');
      }
      throw error;
    }
  }

  async list({ subjectId, limit, offset }: {
    subjectId?: string;
    limit: number;
    offset: number;
  }): Promise<SubjectGroup[]> {
    const query = subjectId === undefined
      ? `SELECT ${SUBJECT_GROUP_COLUMNS}
         FROM subject_academic_groups
         ORDER BY subject_id ASC, academic_group_id ASC
         LIMIT $1 OFFSET $2`
      : `SELECT ${SUBJECT_GROUP_COLUMNS}
         FROM subject_academic_groups
         WHERE subject_id = $1
         ORDER BY subject_id ASC, academic_group_id ASC
         LIMIT $2 OFFSET $3`;
    const params = subjectId === undefined ? [limit, offset] : [subjectId, limit, offset];
    const { rows } = await this.pool.query<SubjectGroupRow>(query, params);
    return rows.map(rowToSubjectGroup);
  }
}

function rowToSubjectGroup(row: SubjectGroupRow): SubjectGroup {
  return new SubjectGroup({
    subjectId: row.subject_id,
    academicGroupId: row.academic_group_id,
    careerId: row.career_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}
