import type { Student } from '../domain/student.entity.js';
import type { Queryable } from '../../shared/application/unit-of-work.js';

/**
 * Ports for the students module. Use cases depend on these interfaces
 * only; infrastructure implementations (pg) are injected at wiring time,
 * keeping the dependency direction domain <- application <- infrastructure.
 * The optional `client` lets alta-en-uno flows persist the student row
 * inside the same transaction as the user account.
 */
export interface StudentRepositoryPort {
  /**
   * Finds a student by `codalumno` case-insensitively (STU-003): the
   * query normalizes both sides with `lower()`, matching the functional
   * unique index so a different-casing variant is a duplicate.
   */
  findByCodalumno(codalumno: string): Promise<Student | null>;
  create(student: Student, client?: Queryable): Promise<Student>;
}