import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { User } from '../../../auth/domain/user.entity.js';
import { normalizeEmail, normalizeUsername, validatePassword } from '../../../shared/domain/validation.js';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { isUniqueViolation, translateUniqueViolation } from '../../../auth/application/unique-violation.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import type { PasswordHasherPort } from '../../../auth/application/auth.ports.js';
import type { ReceptionAccessRepository, ReceptionCareerGrant } from '../../application/reception.ports.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

const CAREERS = new Set(['kinesiology', 'odontology']);

export function createReceptionRouter({ repository, hasher, surface = 'admin', adminGuard = new PermissionGuard('reception:accounts:write'), grantGuard = new PermissionGuard('reception:careers:write'), readGuard = new PermissionGuard('reception:careers:read'), getActor = defaultGetActor, authenticate }: {
  authenticate?: RequestHandler;
  repository: ReceptionAccessRepository;
  hasher: PasswordHasherPort;
  surface?: 'admin' | 'self';
  adminGuard?: Guard;
  grantGuard?: Guard;
  readGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const authentication = authenticate ? [authenticate] : [];
  if (surface === 'admin') {
  router.post('/accounts', ...authentication, async (req: Request, res: Response) => {
    await authorizeAdmin(adminGuard, req);
    for (const field of ['username', 'password', 'email']) {
      if (req.body?.[field] != null && typeof req.body[field] !== 'string') {
        throw new BadRequestError(`${field} must be a string`);
      }
    }
    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;
    validatePassword(password);
    const email = normalizeEmail(req.body?.email);
    if (!email) throw new BadRequestError('email is required');
    const actorId = await verifiedActor(req, getActor);
    const user = User.create({ username, passwordHash: await hasher.hash(password), role: 'reception', email, createdBy: actorId });
    try {
      const created = await repository.createAccount(user);
      res.status(201).json(created.toJSON());
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw translateUniqueViolation(error, { username, email });
    }
  });

  router.get('/accounts/:userId/careers', ...authentication, async (req: Request, res: Response) => {
    await authorizeAdmin(grantGuard, req);
    const grants = await repository.listGrants(pathUuid(req.params.userId, 'userId'));
    res.status(200).json({ items: grants.map(serializeGrant) });
  });

  router.post('/accounts/:userId/careers', ...authentication, async (req: Request, res: Response) => {
    await authorizeAdmin(grantGuard, req);
    const careerCode = req.body?.career;
    if (typeof careerCode !== 'string' || !CAREERS.has(careerCode)) throw new BadRequestError('career must be kinesiology or odontology');
    const grant = await repository.grantCareer(pathUuid(req.params.userId, 'userId'), careerCode, await verifiedActor(req, getActor));
    res.status(201).json(serializeGrant(grant));
  });

  router.post('/career-grants/:grantId/revoke', ...authentication, async (req: Request, res: Response) => {
    await authorizeAdmin(grantGuard, req);
    const grant = await repository.revokeGrant(pathUuid(req.params.grantId, 'grantId'), await verifiedActor(req, getActor));
    res.status(200).json(serializeGrant(grant));
  });

  }

  if (surface === 'self') router.get('/careers', ...authentication, async (req: Request, res: Response) => {
    await readGuard.authorize(req);
    const auth = (req as AuthenticatedRequest).auth;
    if (auth?.role !== 'reception') throw new ForbiddenError('Reception role required');
    const userId = await verifiedActor(req, getActor);
    const grants = await repository.listGrants(userId, true);
    res.status(200).json({ careers: [...new Set(grants.map((grant) => grant.careerCode))] });
  });
  return router;
}

async function authorizeAdmin(guard: Guard, req: Request): Promise<void> {
  await guard.authorize(req);
  if ((req as AuthenticatedRequest).auth?.role !== 'admin') throw new ForbiddenError('Admin role required');
}

function pathUuid(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestError(`${name} must be a UUID`);
  }
  return value;
}

async function verifiedActor(req: Request, getActor: (req: Request) => Promise<string | null>): Promise<string> {
  const actor = await getActor(req);
  if (!actor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor)) {
    throw new UnauthorizedError('A verified UUID actor is required');
  }
  return actor;
}

function serializeGrant(grant: ReceptionCareerGrant) {
  return { id: grant.id, user_id: grant.userId, career: grant.careerCode, granted_by: grant.grantedBy,
    granted_at: new Date(grant.grantedAt).toISOString(), revoked_by: grant.revokedBy,
    revoked_at: grant.revokedAt === null ? null : new Date(grant.revokedAt).toISOString() };
}
