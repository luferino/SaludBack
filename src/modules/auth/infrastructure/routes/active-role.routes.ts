import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import type { RoleGrantRepository, UserRoleGrant } from '../../application/active-role.ports.js';
import type { TokenServicePort, PermissionMatrixReader } from '../../application/auth.ports.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Admin-only management of the predefined additional Reception membership. */
export function createActiveRoleAdminRouter({ repository, authenticate, guard = new PermissionGuard('reception:accounts:write'), tokenService, matrixReader }: {
  repository: RoleGrantRepository; authenticate?: RequestHandler; guard?: Guard;
  tokenService?: TokenServicePort; matrixReader?: PermissionMatrixReader;
}): Router {
  const router = Router();
  const auth = authenticate ? [authenticate] : [];

  router.get('/roles', ...auth, async (req: Request, res: Response) => {
    const authContext = (req as AuthenticatedRequest).auth;
    const userId = authContext?.userId ?? authContext?.sub;
    if (!userId || !UUID.test(userId) || !authContext?.role) throw new UnauthorizedError('A verified UUID actor is required');
    await requireCurrentMembership(repository, userId, authContext.role, authContext.roleGrantId);
    const availableRoles = await repository.availableRoles(userId);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ active_role: authContext.role, available_roles: availableRoles });
  });

  router.post('/active-role', ...auth, async (req: Request, res: Response) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)
        || Object.keys(req.body).length !== 1 || typeof req.body.role !== 'string') {
      throw new BadRequestError('body must contain exactly role');
    }
    const authContext = (req as AuthenticatedRequest).auth;
    const userId = authContext?.userId ?? authContext?.sub;
    if (!userId || !UUID.test(userId) || typeof authContext?.username !== 'string' || !authContext.role) throw new UnauthorizedError('A verified UUID actor is required');
    await requireCurrentMembership(repository, userId, authContext.role, authContext.roleGrantId);
    if (!tokenService || !matrixReader) throw new Error('active-role token services are not configured');
    const available = await repository.availableRoles(userId);
    const target = req.body.role as string;
    if (!available.includes(target)) throw new ForbiddenError('Requested role is not available');
    const primary = available[0];
    const roleGrant = target === 'reception' && primary !== 'reception'
      ? await repository.activeReceptionRoleGrant(userId) : null;
    if (target === 'reception' && primary !== 'reception' && !roleGrant) throw new ForbiddenError('Requested role is not available');
    const permissions = await matrixReader.permissionsForRole(target);
    const claims: { sub: string; username: string; role: string; permissions: readonly string[]; role_grant_id?: string } = {
      sub: userId, username: authContext.username, role: target, permissions,
    };
    if (roleGrant) claims.role_grant_id = roleGrant.id;
    res.status(200).json({ token: await tokenService.sign(claims) });
  });

  router.get('/reception-role-candidates', ...auth, async (req: Request, res: Response) => {
    await authorizeAdmin(guard, req);
    const query = strictQuery(req);
    const q = query.get('q')?.trim();
    if (!q) throw new BadRequestError('q is required');
    if (q.length > 100) throw new BadRequestError('q must be at most 100 characters');
    const limit = page(query, 'limit', 20, 1, 100);
    const offset = page(query, 'offset', 0, 0, 10000);
    const items = await repository.searchStudentCandidates({ q, limit, offset });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ items, limit, offset });
  });

  router.get('/accounts/:userId/reception-role', ...auth, async (req: Request, res: Response) => {
    await authorizeAdmin(guard, req);
    const userId = pathUuid(req.params.userId, 'userId');
    const items = await repository.listReceptionRoleGrants(userId);
    res.status(200).json({ items: items.map(serializeGrant) });
  });

  router.post('/accounts/:userId/reception-role', ...auth, async (req: Request, res: Response) => {
    await authorizeAdmin(guard, req);
    const userId = pathUuid(req.params.userId, 'userId');
    emptyBody(req.body);
    const grant = await repository.grantReceptionRole(userId, await verifiedActor(req));
    res.status(201).json(serializeGrant(grant));
  });

  router.post('/reception-role-grants/:grantId/revoke', ...auth, async (req: Request, res: Response) => {
    await authorizeAdmin(guard, req);
    const grantId = pathUuid(req.params.grantId, 'grantId');
    emptyBody(req.body);
    const grant = await repository.revokeReceptionRoleGrant(grantId, await verifiedActor(req));
    res.status(200).json(serializeGrant(grant));
  });
  return router;
}

async function requireCurrentMembership(repository: RoleGrantRepository, userId: string, role: string, grantId?: string): Promise<void> {
  if (!await repository.isValidActiveRole(userId, role, grantId)) {
    throw new UnauthorizedError('Invalid or missing token');
  }
}

async function authorizeAdmin(guard: Guard, req: Request): Promise<void> {
  await guard.authorize(req);
  if ((req as AuthenticatedRequest).auth?.role !== 'admin') throw new ForbiddenError('Admin role required');
}

function strictQuery(req: Request): URLSearchParams {
  const start = req.originalUrl.indexOf('?');
  const query = new URLSearchParams(start < 0 ? '' : req.originalUrl.slice(start + 1));
  const allowed = new Set(['q', 'limit', 'offset']);
  for (const key of query.keys()) {
    if (!allowed.has(key)) throw new BadRequestError(`unknown query parameter: ${key}`);
    if (query.getAll(key).length !== 1) throw new BadRequestError(`query parameter must not be repeated: ${key}`);
  }
  return query;
}

function page(query: URLSearchParams, name: 'limit' | 'offset', fallback: number, min: number, max: number): number {
  const value = query.get(name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new BadRequestError(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}

function pathUuid(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestError(`${name} must be a UUID`);
  return value;
}

async function verifiedActor(req: Request): Promise<string> {
  const auth = (req as AuthenticatedRequest).auth;
  const actor = auth?.userId ?? auth?.sub;
  if (!actor || !UUID.test(actor)) throw new UnauthorizedError('A verified UUID actor is required');
  return actor;
}

function emptyBody(body: unknown): void {
  if (body === undefined) return;
  if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length !== 0) {
    throw new BadRequestError('request body must be empty');
  }
}

function serializeGrant(grant: UserRoleGrant) {
  return {
    id: grant.id, user_id: grant.userId, role: grant.role, granted_by: grant.grantedBy,
    granted_at: new Date(grant.grantedAt).toISOString(), revoked_by: grant.revokedBy,
    revoked_at: grant.revokedAt === null ? null : new Date(grant.revokedAt).toISOString(),
  };
}
