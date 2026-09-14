import { User } from '../domain/user.entity.js';
import { BadRequestError, ConflictError } from '../../shared/domain/errors.js';
import { normalizeUsername, validatePassword, normalizeEmail } from '../../shared/domain/validation.js';
import { isUniqueViolation, translateUniqueViolation } from './unique-violation.js';
import type { UserRepositoryPort, PasswordHasherPort } from './auth.ports.js';

export interface RegisterUserInput {
  username: string;
  password: string;
  email: string;
  createdBy?: string | null;
}

/**
 * Register Student Account use case.
 * Admin-originated alta of `estudiante` users: validate input, hash the
 * password, reject duplicates (username and email), persist. Ports
 * (repository, hasher) are injected; the policy guard in front of it
 * lives at route wiring. `createdBy` carries the acting admin id
 * (resolved from the verified token `sub` at route level, AUD-003) so
 * the users row records who registered the account.
 */
export class RegisterUser {
  private readonly repository: UserRepositoryPort;
  private readonly hasher: PasswordHasherPort;

  constructor({ repository, hasher }: { repository: UserRepositoryPort; hasher: PasswordHasherPort }) {
    this.repository = repository;
    this.hasher = hasher;
  }

  async execute({ username, password, email, createdBy = null }: RegisterUserInput): Promise<User> {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    // Email is required for register: normalize (trim + validate) so
    // padded values are accepted and stored trimmed, then enforce
    // presence on the normalized value only.
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      throw new BadRequestError('email is required');
    }

    const existing = await this.repository.findByUsername(normalizedUsername);
    if (existing) {
      throw new ConflictError(`username already exists: ${normalizedUsername}`);
    }

    const existingByEmail = await this.repository.findByEmail(normalizedEmail);
    if (existingByEmail) {
      throw new ConflictError(`email already exists: ${normalizedEmail}`);
    }

    const passwordHash = await this.hasher.hash(password);
    const user = User.create({ username: normalizedUsername, passwordHash, role: 'estudiante', email: normalizedEmail, createdBy });
    try {
      return await this.repository.create(user);
    } catch (error) {
      // TOCTOU race (or a row the pre-check lookup missed): the unique
      // index surfaces as a raw pg unique_violation (SQLSTATE 23505).
      // Translate it into the same ConflictError the pre-checks raise so
      // callers get a clean 409 and never see a leaked SQL string.
      if (!isUniqueViolation(error)) {
        throw error;
      }
      throw translateUniqueViolation(error, { username: normalizedUsername, email: normalizedEmail });
    }
  }
}
