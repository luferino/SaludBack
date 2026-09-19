import { UnauthorizedError } from '../../shared/domain/errors.js';
import type { UserRepositoryPort } from './auth.ports.js';

export interface GetCurrentUserInput {
  userId?: string;
}

/**
 * Canonical UUID shape (8-4-4-4-12 hex, case-insensitive). `users.id`
 * is a Postgres uuid PK: any other subject shape would raise 22P02 on
 * the `WHERE id = $1` cast and surface as a 500, so malformed
 * identities are rejected here, before the DB read (PR-002).
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Narrow response contract for GET /auth/me (PR-001): exactly three keys,
 * never the password hash, audit columns, `id`, `sub` or `permissions`.
 */
export interface CurrentUserOutput {
  username: string;
  email: string | null;
  role: string;
}

/**
 * Reads the authenticated account fresh from the database by primary key.
 * The payload is built from the stored row only — JWT claims never enter
 * it (PR-001), so a token issued before an email change still shows the
 * updated value. A missing identity, a malformed (non-UUID) subject or a
 * subject that matches no user row is an invalid identity and throws 401
 * (PR-002); the policy stays in the app layer, not in the route.
 */
export class GetCurrentUser {
  private readonly repository: UserRepositoryPort;

  constructor({ repository }: { repository: UserRepositoryPort }) {
    this.repository = repository;
  }

  async execute({ userId }: GetCurrentUserInput): Promise<CurrentUserOutput> {
    if (!userId || !UUID_SHAPE.test(userId)) {
      throw new UnauthorizedError('Invalid or missing token');
    }
    const user = await this.repository.findById(userId);
    if (!user) {
      throw new UnauthorizedError('Invalid or missing token');
    }
    return { username: user.username, email: user.email, role: user.role };
  }
}