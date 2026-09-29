import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../../../shared/domain/errors.js';
import type { TokenServicePort, TokenClaims, PermissionMatrixReader } from '../../application/auth.ports.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';

/**
 * Token-verification middleware. Reads a Bearer token from the
 * Authorization header, verifies it through the injected TokenService and
 * exposes `req.auth = { role, permissions, sub, userId }` to downstream
 * handlers, where `sub`/`userId` are the verified token subject (user id)
 * when the token carries a `sub` claim; when the token has no `sub` claim
 * both fields stay absent (AUTH-002). `permissions` is recomputed from the
 * permission matrix on EVERY request via the injected
 * `matrixReader.permissionsForRole(role)` (DB wins; the token `permissions`
 * claim is advisory and ignored — there is no backfill branch, the DB is the
 * single source of truth, PG-001). Missing, malformed, expired or otherwise
 * invalid tokens are converted to an {@link UnauthorizedError} so the error
 * handler responds 401 and the protected handler never runs. A matrix-read
 * failure (e.g. the database is unreachable) is forwarded UNCHANGED —
 * outside the verify catch — so the error handler answers 500
 * INTERNAL_SERVER_ERROR (fail closed): a server fault must not be
 * misclassified as a client-auth fault.
 */
export function authenticate(tokenService: TokenServicePort, matrixReader: PermissionMatrixReader) {
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

    let decoded: TokenClaims;
    try {
      decoded = await tokenService.verify(token);
    } catch {
      // 401: token problem. The matrix is never consulted for a token that
      // did not verify — fail-fast before the DB read.
      return next(new UnauthorizedError('Invalid or missing token'));
    }

    const role = typeof decoded.role === 'string' ? decoded.role : '';
    let permissions: readonly string[];
    try {
      permissions = await matrixReader.permissionsForRole(role); // DB wins; claim ignored
    } catch (error) {
      return next(error as Error); // fail closed -> error handler -> 500
    }

    const authReq = req as AuthenticatedRequest;
    authReq.auth = { role, permissions: [...permissions] };
    if (typeof decoded.sub === 'string') {
      authReq.auth.sub = decoded.sub;
      authReq.auth.userId = decoded.sub;
    }
    return next();
  };
}