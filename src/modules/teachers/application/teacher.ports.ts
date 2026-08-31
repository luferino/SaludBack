import type { Teacher } from '../domain/teacher.entity.js';
import type { Queryable } from '../../shared/application/unit-of-work.js';

/**
 * Ports for the teachers module. Use cases depend on these interfaces
 * only; infrastructure implementations (pg) are injected at wiring time,
 * keeping the dependency direction domain <- application <- infrastructure.
 * The optional `client` lets alta-en-uno flows persist the teacher row
 * inside the same transaction as the user account.
 */
export interface TeacherRepositoryPort {
  /**
   * Persists a teacher profile row. Unlike students, teachers have no
   * `codalumno`, so there is no duplicate-key guard: linking is driven
   * by the account (username/email) via the user repository.
   */
  create(teacher: Teacher, client?: Queryable): Promise<Teacher>;
}