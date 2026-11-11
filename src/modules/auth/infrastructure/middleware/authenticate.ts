import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../../../shared/domain/errors.js';
import type { TokenServicePort, TokenClaims, PermissionMatrixReader } from '../../application/auth.ports.js';
import type { LiveRoleReader } from '../../application/active-role.ports.js';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authenticate(tokenService: TokenServicePort, matrixReader: PermissionMatrixReader, liveRoleReader?: LiveRoleReader) {
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
    const userId = typeof decoded.sub === 'string' ? decoded.sub : undefined;
    const hasGrantClaim = Object.prototype.hasOwnProperty.call(decoded, 'role_grant_id');
    const grantId = decoded.role_grant_id;
    if (hasGrantClaim && (!role || role !== 'reception' || !userId || !UUID.test(userId)
        || typeof grantId !== 'string' || !UUID.test(grantId) || !liveRoleReader)) {
      return next(new UnauthorizedError('Invalid or missing token'));
    }
    // Legacy JWTs without an additional-role claim retain the established
    // signature-verification and permission-matrix contract. Current primary
    // membership is checked locally by role-discovery/switch endpoints; adding
    // a global lookup here would break existing role-to-matrix delegation.
    // Additional Reception claims, however, require the exact live grant on
    // every protected request and never fall back to the primary identity.
    if (hasGrantClaim) {
      try {
        if (!await liveRoleReader!.isValidActiveRole(userId!, role, grantId as string)) {
          return next(new UnauthorizedError('Invalid or missing token'));
        }
      } catch (error) {
        return next(error as Error); // A live grant database failure is a server fault, not a token fault.
      }
    }
    let permissions: readonly string[];
    try {
      permissions = await matrixReader.permissionsForRole(role); // DB wins; claim ignored
    } catch (error) {
      return next(error as Error); // fail closed -> error handler -> 500
    }

    const authReq = req as AuthenticatedRequest;
    authReq.auth = { role, permissions: [...permissions] };
    if (userId) {
      authReq.auth.sub = userId;
      authReq.auth.userId = userId;
    }
    if (typeof decoded.username === 'string') authReq.auth.username = decoded.username;
    if (hasGrantClaim && typeof grantId === 'string') authReq.auth.roleGrantId = grantId;
    return next();
  };
}