import { User } from '../domain/user.js';
import { BadRequestError, ConflictError } from '../../shared/domain/errors.js';

/**
 * Register Student Account use case.
 * Admin-originated alta of `estudiante` users: validate input, hash the
 * password, reject duplicates, persist. Ports (repository, hasher) are
 * injected; the policy guard in front of it lives at route wiring.
 */
export class RegisterUser {
  constructor({ repository, hasher }) {
    this.repository = repository;
    this.hasher = hasher;
  }

  async execute({ username, password } = {}) {
    if (!username || username.trim() === '') {
      throw new BadRequestError('username is required');
    }
    if (!password) {
      throw new BadRequestError('password is required');
    }

    const existing = await this.repository.findByUsername(username);
    if (existing) {
      throw new ConflictError(`username already exists: ${username}`);
    }

    const passwordHash = await this.hasher.hash(password);
    const user = User.create({ username, passwordHash, role: 'estudiante' });
    return this.repository.create(user);
  }
}
