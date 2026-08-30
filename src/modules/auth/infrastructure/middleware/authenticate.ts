import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../../../shared/domain/errors.js';
import type { TokenServicePort } from '../../application/auth.ports.js';

export interface AuthenticatedRequest extends Request {
  auth?: {
    role: string;
    permissions: string[];
    sub?: string;
  };
}

/**
 * Token-verification middleware. Reads a Bearer token from the
 * Authorization header, verifies it through the injected TokenService and
 * exposes `req.auth = { role, permissions, sub }` to downstream handlers,
 * where `sub` is the verified token subject (user id) when present.
 * Missing, malformed, expired or otherwise invalid tokens are converted
 * to an {@link UnauthorizedError} so the error handler responds 401 and
 * the protected handler never runs.
 */
export function authenticate(tokenService: TokenServicePort) {
  return async function authenticateMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

    if (!token) {
      return next(new UnauthorizedError('Invalid or missing token'));
    }

    try {
      const decoded = await tokenService.verify(token);
      const authReq = req as AuthenticatedRequest;
      authReq.auth = {
        role: typeof decoded.role === 'string' ? decoded.role : '',
        permissions: Array.isArray(decoded.permissions) ? (decoded.permissions as string[]) : [],
      };
      if (typeof decoded.sub === 'string') {
        authReq.auth.sub = decoded.sub;
      } else if (typeof decoded.userId === 'string') {
        authReq.auth.sub = decoded.userId;
      }
      return next();
    } catch {
      return next(new UnauthorizedError('Invalid or missing token'));
    }
  };
}
