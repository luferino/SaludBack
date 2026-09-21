import type { User } from '../domain/user.entity.js';
import type { PasswordResetToken } from '../domain/password-reset-token.entity.js';
import type { Queryable } from '../../shared/application/unit-of-work.js';

/**
 * Ports for the auth module. Use cases depend on these interfaces only;
 * infrastructure implementations (pg, bcryptjs, jsonwebtoken) are
 * injected at wiring time, keeping the dependency direction
 * domain <- application <- infrastructure.
 */

export interface UserRepositoryPort {
  findByUsername(username: string): Promise<User | null>;
  /**
   * Persists a new user. Rows carry the audit columns
   * (created_by/updated_by/updated_at — UAC-001) on the User entity;
   * registration records the acting admin in `created_by` (AUD-003) and
   * creation leaves both `updated_*` columns NULL. An
   * optional `client` lets alta-en-uno flows create the account inside
   * the same transaction as the profile row (defaults to the pool).
   */
  create(user: User, client?: Queryable): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  /**
   * Finds a user by primary key. Returns null when no row matches; used by
   * GET /auth/me to read the account fresh from the database (PR-001).
   */
  findById(userId: string): Promise<User | null>;
  updatePassword(userId: string, newPasswordHash: string): Promise<void>;
}

export interface PasswordHasherPort {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

export interface TokenClaims {
  sub?: string;
  username?: string;
  role?: string;
  permissions?: readonly string[];
  [key: string]: unknown;
}

export interface TokenServicePort {
  sign(claims: TokenClaims): Promise<string>;
  verify(token: string): Promise<TokenClaims>;
}

/**
 * Reads the role→permission matrix from the database (PG-001): the seeded
 * `role_permissions` grants are the single source of truth. `authenticate`
 * recomputes `req.auth.permissions` through this port on every protected
 * request (DB wins; the token `permissions` claim is advisory) and
 * `LoginUser` signs fresh claims from it. An unknown role or a role with
 * no grants resolves to an empty array — NOT an error; only thrown errors
 * are failures (fail closed → 500).
 */
export interface PermissionMatrixReader {
  permissionsForRole(role: string): Promise<readonly string[]>;
}

export interface ResetTokenCreateParams {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface ResetTokenRepositoryPort {
  create(params: ResetTokenCreateParams): Promise<PasswordResetToken>;
  findValidByHash(tokenHash: string): Promise<PasswordResetToken | null>;
  markUsed(id: string): Promise<void>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailerPort {
  sendMail(message: MailMessage): Promise<void>;
}
