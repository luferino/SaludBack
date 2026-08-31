import type { Pool } from 'pg';
import { Teacher } from '../../domain/teacher.entity.js';
import type { TeacherRepositoryPort } from '../../application/teacher.ports.js';
import type { Queryable } from '../../../shared/application/unit-of-work.js';

interface TeacherRow {
  id: string;
  user_id: string;
  nombres: string;
  apellidos: string;
  email: string | null;
  celular: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_by: string | null;
  updated_at: Date | string | null;
}

const TEACHER_COLUMNS =
  'id, user_id, nombres, apellidos, email, celular, created_by, created_at, updated_by, updated_at';

/**
 * PostgreSQL implementation of the TeacherRepository port.
 * Receives a `pg` Pool (or any duck-typed `{ query }`) via constructor
 * injection so tests can pass a fake pool. `create` accepts an optional
 * client so the teacher row joins the alta-en-uno transaction.
 * No `findByCodalumno` counterpart exists: teachers have no student
 * code, so duplicate detection is purely account-driven (TEA-001).
 */
export class PgTeacherRepository implements TeacherRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(teacher: Teacher, client?: Queryable): Promise<Teacher> {
    const db = client ?? this.pool;
    const { rows } = await db.query<TeacherRow>(
      `INSERT INTO teachers (user_id, nombres, apellidos, email, celular, created_by, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${TEACHER_COLUMNS}`,
      [
        teacher.userId,
        teacher.nombres,
        teacher.apellidos,
        teacher.email,
        teacher.celular,
        teacher.createdBy,
        teacher.updatedBy,
        teacher.updatedAt,
      ],
    );
    return rowToTeacher(rows[0]);
  }
}

function rowToTeacher(row: TeacherRow): Teacher {
  return new Teacher({
    id: row.id,
    userId: row.user_id,
    nombres: row.nombres,
    apellidos: row.apellidos,
    email: row.email,
    celular: row.celular,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
}