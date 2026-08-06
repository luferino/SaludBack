import { UnauthorizedError } from '../../../shared/domain/errors.js';

/**
 * Token-verification middleware. Reads a Bearer token from the
 * Authorization header, verifies it through the injected TokenService and
 * exposes `req.auth = { role, permissions }` to downstream handlers.
 * Missing, malformed, expired or otherwise invalid tokens are converted
 * to an {@link UnauthorizedError} so the error handler responds 401 and
 * the protected handler never runs.
 *
 * @param {import('../../application/ports.js').TokenServicePort} tokenService
 * @returns {import('express').RequestHandler}
 */
export function authenticate(tokenService) {
  return async function authenticateMiddleware(req, _res, next) {
    const header = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

    if (!token) {
      return next(new UnauthorizedError('Invalid or missing token'));
    }

    try {
      const decoded = await tokenService.verify(token);
      req.auth = {
        role: decoded.role,
        permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
      };
      return next();
    } catch {
      return next(new UnauthorizedError('Invalid or missing token'));
    }
  };
}
