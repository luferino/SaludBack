import { BadRequestError, UnauthorizedError } from '../../shared/domain/errors.js';
import { normalizeUsername } from '../../shared/domain/validation.js';
import type {
  UserRepositoryPort,
  PasswordHasherPort,
  TokenServicePort,
  PermissionMatrixReader,
} from './auth.ports.js';

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
 * The signed token's `permissions` claim is derived from the injected
 * `matrixReader.permissionsForRole(role)` (DB wins; the seed `role_permissions`
 * grants are the single source of truth — PG-001), NOT from a code constant.
 * A matrix-read failure propagates unchanged (fail closed → 500 at login,
 * matching `authenticate`).
 */
export class LoginUser {
  private readonly repository: UserRepositoryPort;
  private readonly hasher: PasswordHasherPort;
  private readonly tokenService: TokenServicePort;
  private readonly matrixReader: PermissionMatrixReader;

  constructor({
    repository,
    hasher,
    tokenService,
    matrixReader,
  }: {
    repository: UserRepositoryPort;
    hasher: PasswordHasherPort;
    tokenService: TokenServicePort;
    matrixReader: PermissionMatrixReader;
  }) {
    this.repository = repository;
    this.hasher = hasher;
    this.tokenService = tokenService;
    this.matrixReader = matrixReader;
  }

  async execute({ username, password }: LoginUserInput): Promise<LoginUserOutput> {
    if (!username || username.trim() === '') {
      throw new BadRequestError('username is required');
    }
    if (!password) {
      throw new BadRequestError('password is required');
    }

    const normalizedUsername = normalizeUsername(username);
    const user = await this.repository.findByUsername(normalizedUsername);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const passwordMatches = await this.hasher.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const permissions = await this.matrixReader.permissionsForRole(user.role);
    const token = await this.tokenService.sign({
      sub: user.id ?? undefined,
      username: user.username,
      role: user.role,
      permissions,
    });
    return { token };
  }
}
