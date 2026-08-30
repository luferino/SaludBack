import type { Request } from 'express';
import { UnauthorizedError } from '../domain/errors.js';

/**
 * Guard port: a single policy boundary in front of a use case.
 * Implementations decide whether `request` may proceed and either
 * resolve or throw an {@link UnauthorizedError}. Wired at route
 * creation so swapping the policy is a drop-in change, never a
 * use-case change.
 */
export class Guard {
  async authorize(_request: Request): Promise<void> {
    throw new Error('Guard#authorize must be implemented by a subclass');
  }
}

/**
 * Default-open guard. Allows every request so unauthenticated flows
 * (e.g. POST /auth/register while no admin role exists) keep working;
 * a policy guard such as an AdminGuard can replace it later.
 */
export class OpenGuard extends Guard {
  async authorize(): Promise<void> {
    // Allow all requests.
  }
}
