import type { User } from '../domain/user.entity.js';
import type { PasswordResetToken } from '../domain/password-reset-token.entity.js';

/**
 * Ports for the auth module. Use cases depend on these interfaces only;
 * infrastructure implementations (pg, bcryptjs, jsonwebtoken) are
 * injected at wiring time, keeping the dependency direction
 * domain <- application <- infrastructure.
 */

export interface UserRepositoryPort {
  findByUsername(username: string): Promise<User | null>;
  create(user: User): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
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
