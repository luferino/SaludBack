import { User } from '../domain/user.entity.js';
import { ConflictError } from '../../shared/domain/errors.js';
import { normalizeUsername, validatePassword, validateEmail } from '../../shared/domain/validation.js';
import type { UserRepositoryPort, PasswordHasherPort } from './auth.ports.js';

export interface RegisterUserInput {
  username: string;
  password: string;
  email: string;
}

/**
 * Register Student Account use case.
 * Admin-originated alta of `estudiante` users: validate input, hash the
 * password, reject duplicates (username and email), persist. Ports
 * (repository, hasher) are injected; the policy guard in front of it
 * lives at route wiring.
 */
export class RegisterUser {
  private readonly repository: UserRepositoryPort;
  private readonly hasher: PasswordHasherPort;

  constructor({ repository, hasher }: { repository: UserRepositoryPort; hasher: PasswordHasherPort }) {
    this.repository = repository;
    this.hasher = hasher;
  }

  async execute({ username, password, email }: RegisterUserInput): Promise<User> {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    validateEmail(email);

    const existing = await this.repository.findByUsername(normalizedUsername);
    if (existing) {
      throw new ConflictError(`username already exists: ${normalizedUsername}`);
    }

    const existingByEmail = await this.repository.findByEmail(email);
    if (existingByEmail) {
      throw new ConflictError(`email already exists: ${email}`);
    }

    const passwordHash = await this.hasher.hash(password);
    const user = User.create({ username: normalizedUsername, passwordHash, role: 'estudiante', email });
    return this.repository.create(user);
  }
}
