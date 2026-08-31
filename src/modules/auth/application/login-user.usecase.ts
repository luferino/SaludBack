import { BadRequestError, UnauthorizedError } from '../../shared/domain/errors.js';
import { permissionsForRole } from '../domain/permissions.js';
import type { UserRepositoryPort, PasswordHasherPort, TokenServicePort } from './auth.ports.js';

export interface LoginUserInput {
  username: string;
  password: string;
}

export interface LoginUserOutput {
  token: string;
}

/**
 * Login with Credentials use case.
 * validate -> findByUsername -> compare -> sign. Both the unknown-username
 * and wrong-password paths throw the same generic 401 so the response
 * never reveals whether a username exists (no user enumeration).
 * Ports (repository, hasher, tokenService) are injected.
 */
export class LoginUser {
  private readonly repository: UserRepositoryPort;
  private readonly hasher: PasswordHasherPort;
  private readonly tokenService: TokenServicePort;

  constructor({
    repository,
    hasher,
    tokenService,
  }: {
    repository: UserRepositoryPort;
    hasher: PasswordHasherPort;
    tokenService: TokenServicePort;
  }) {
    this.repository = repository;
    this.hasher = hasher;
    this.tokenService = tokenService;
  }

  async execute({ username, password }: LoginUserInput): Promise<LoginUserOutput> {
    if (!username || username.trim() === '') {
      throw new BadRequestError('username is required');
    }
    if (!password) {
      throw new BadRequestError('password is required');
    }

    const user = await this.repository.findByUsername(username);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const passwordMatches = await this.hasher.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const token = await this.tokenService.sign({
      sub: user.id ?? undefined,
      username: user.username,
      role: user.role,
      permissions: permissionsForRole(user.role),
    });
    return { token };
  }
}
