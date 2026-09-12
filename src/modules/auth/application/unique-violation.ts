import { ConflictError } from '../../shared/domain/errors.js';

/**
 * Structural shape of a pg unique_violation error (SQLSTATE 23505).
 * Checked by field presence only — no pg import — so any driver that
 * surfaces `code`/`constraint` on the error works (pg does; unit tests
 * mimic the shape).
 */
export interface UniqueViolationError extends Error {
  code?: string;
  constraint?: string;
}

export function isUniqueViolation(error: unknown): error is UniqueViolationError {
  return error instanceof Error && (error as UniqueViolationError).code === '23505';
}

function isConstraint(error: UniqueViolationError, constraint: string): boolean {
  return error.constraint === constraint;
}

/**
 * Translates a confirmed 23505 into the same ConflictError the pre-check
 * lookups raise, disambiguating by the violated constraint. Constraint
 * names come from the migrations: `users_email_unique` (003, explicit
 * index) vs the column-unique default `users_username_key` (001). When
 * `email` is null/empty the email branch can never fire (PostgreSQL
 * allows multiple NULL emails in a unique index), so a 23505 is then
 * always the username.
 */
export function translateUniqueViolation(
  error: UniqueViolationError,
  { username, email }: { username: string; email?: string | null },
): ConflictError {
  if (email && isConstraint(error, 'users_email_unique')) {
    return new ConflictError(`email already exists: ${email}`);
  }
  return new ConflictError(`username already exists: ${username}`);
}