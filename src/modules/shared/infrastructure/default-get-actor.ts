import type { Request } from 'express';
import type { AuthenticatedRequest } from '../application/authenticated-request.js';

/**
 * Default actor hook: reads the verified token subject from `req.auth`,
 * preferring the `userId` alias and falling back to `sub` (both are set
 * by `authenticate` when the token carries a `sub` claim — AUTH-002).
 * Resolves to null when `req.auth` is unset (open route) or lacks a
 * subject; a guard or token middleware can set the seam without changing
 * the contract (AUD-003). Shared by all route factories so `created_by`
 * attribution is resolved identically across modules.
 */
export async function defaultGetActor(req: Request): Promise<string | null> {
  const authReq = req as AuthenticatedRequest;
  return authReq.auth?.userId ?? authReq.auth?.sub ?? null;
}