import type { Request } from 'express';
import { UnauthorizedError, ForbiddenError } from '../domain/errors.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

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

/**
 * Admin-only policy guard. Requires the request to carry a verified
 * `req.auth` (populated by the `authenticate` middleware) whose role is
 * `admin`. A request that never ran authentication (or failed it) is
 * unauthorized (401); a verified non-admin caller is forbidden (403).
 * Mounted AFTER `authenticate` so the middleware populates `req.auth`
 * before the guard evaluates it.
 */
export class AdminGuard extends Guard {
  async authorize(request: Request): Promise<void> {
    const authReq = request as AuthenticatedRequest;
    if (!authReq.auth) {
      throw new UnauthorizedError('Authentication required');
    }
    if (authReq.auth.role !== 'admin') {
      throw new ForbiddenError('Admin role required');
    }
  }
}
