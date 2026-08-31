import type { Pool } from 'pg';
import { Student } from '../../domain/student.entity.js';
import type { StudentRepositoryPort } from '../../application/student.ports.js';
import type { Queryable } from '../../../shared/application/unit-of-work.js';

interface StudentRow {
  id: string;
  user_id: string;
  nombres: string;
  apellidos: string;
  codalumno: string;
  email: string | null;
  celular: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_by: string | null;
  updated_at: Date | string | null;
}

const STUDENT_COLUMNS =
  'id, user_id, nombres, apellidos, codalumno, email, celular, created_by, created_at, updated_by, updated_at';

/**
 * PostgreSQL implementation of the StudentRepository port.
 * Receives a `pg` Pool (or any duck-typed `{ query }`) via constructor
 * injection so tests can pass a fake pool. `create` accepts an optional
 * client so the student row joins the alta-en-uno transaction.
 */
export class PgStudentRepository implements StudentRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findByCodalumno(codalumno: string): Promise<Student | null> {
    // lower() on both sides matches the functional unique index
    // `students_codalumno_unique` (STU-003), so a different-casing
    // variant resolves to the same row.
    const { rows } = await this.pool.query<StudentRow>(
      `SELECT ${STUDENT_COLUMNS} FROM students WHERE lower(codalumno) = lower($1)`,
      [codalumno],
    );
    return rows.length === 0 ? null : rowToStudent(rows[0]);
  }

  async create(student: Student, client?: Queryable): Promise<Student> {
    const db = client ?? this.pool;
    const { rows } = await db.query<StudentRow>(
      `INSERT INTO students (user_id, nombres, apellidos, codalumno, email, celular, created_by, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${STUDENT_COLUMNS}`,
      [
        student.userId,
        student.nombres,
        student.apellidos,
        student.codalumno,
        student.email,
        student.celular,
        student.createdBy,
        student.updatedBy,
        student.updatedAt,
      ],
    );
    return rowToStudent(rows[0]);
  }
}

function rowToStudent(row: StudentRow): Student {
  return new Student({
    id: row.id,
    userId: row.user_id,
    nombres: row.nombres,
    apellidos: row.apellidos,
    codalumno: row.codalumno,
    email: row.email,
    celular: row.celular,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
}