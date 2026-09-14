import { User } from '../domain/user.entity.js';
import { ConflictError } from '../../shared/domain/errors.js';
import { normalizeUsername, validatePassword, normalizeEmail } from '../../shared/domain/validation.js';
import { isUniqueViolation, translateUniqueViolation } from './unique-violation.js';
import type { UserRepositoryPort, PasswordHasherPort } from './auth.ports.js';

export interface CreateAdminInput {
  username: string;
  password: string;
  email?: string | null;
}

/**
 * First-admin bootstrap use case. Mirrors RegisterUser but forces the
 * `admin` role through the SAME shared validation (normalizeUsername
 * A-Z0-9 uppercased, validatePassword min 10 + letter + digit). This is
 * the only way an admin can be born once register is admin-gated: run via
 * the create-admin CLI script against the dev database. Email stays
 * optional for a bare bootstrap account; when provided it is validated
 * and duplicate-checked like register. Ports (repository, hasher) are
 * injected.
 */
export class CreateAdmin {
  private readonly repository: UserRepositoryPort;
  private readonly hasher: PasswordHasherPort;

  constructor({ repository, hasher }: { repository: UserRepositoryPort; hasher: PasswordHasherPort }) {
    this.repository = repository;
    this.hasher = hasher;
  }

  async execute({ username, password, email = null }: CreateAdminInput): Promise<User> {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    // Empty / whitespace-only emails behave like null: nobody may own
    // `email = ''` (it would sit in the unique index and misattribute a
    // later 23505 to the username branch). normalizeEmail also trims the
    // stored value so the constraint disambiguation stays on the
    // normalized email.
    const cleanEmail = normalizeEmail(email);

    const existing = await this.repository.findByUsername(normalizedUsername);
    if (existing) {
      throw new ConflictError(`username already exists: ${normalizedUsername}`);
    }

    if (cleanEmail) {
      const existingByEmail = await this.repository.findByEmail(cleanEmail);
      if (existingByEmail) {
        throw new ConflictError(`email already exists: ${cleanEmail}`);
      }
    }

    const passwordHash = await this.hasher.hash(password);
    const user = User.create({ username: normalizedUsername, passwordHash, role: 'admin', email: cleanEmail });

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
      throw translateUniqueViolation(error, { username: normalizedUsername, email: cleanEmail });
    }
  }
}