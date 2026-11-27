import { Router } from 'express';
import { AdminGuard, PermissionGuard } from '../../../shared/application/guard.js';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../../shared/domain/errors.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { EndodonticsSubjectRepositoryPort } from '../../application/subject-link.ports.js';

export function createEndodonticsSubjectRouter(
  { repository }: { repository: EndodonticsSubjectRepositoryPort },
): Router {
  const router = Router();
  const admin = new AdminGuard();
  const read = new PermissionGuard('endodontics-subjects:read');
  const write = new PermissionGuard('endodontics-subjects:write');
  const readDrafts = new PermissionGuard('endodontics-drafts:read');

  router.get('/mine', async (req, res) => {
    await readDrafts.authorize(req);
    const actorId = await defaultGetActor(req);
    if (!isCanonicalUuid(actorId)) throw new UnauthorizedError('A verified UUID actor is required');
    const role = (req as AuthenticatedRequest).auth!.role;
    if (role !== 'estudiante' && role !== 'teacher') throw new ForbiddenError('estudiante or teacher role required');
    if (Object.keys(req.query).length) throw new BadRequestError('query parameters are not supported');
    res.setHeader('Cache-Control', 'no-store').json({ items: await repository.listMine(actorId, role) });
  });

  router.post('/', async (req, res) => {
    await admin.authorize(req);
    await write.authorize(req);
    const actor = await defaultGetActor(req);
    if (!actor) throw new UnauthorizedError('token subject is required');
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'subject_id')) {
      throw new BadRequestError('body must contain only subject_id');
    }
    const subjectId = (body as { subject_id?: unknown }).subject_id;
    if (!isCanonicalUuid(subjectId)) throw new BadRequestError('subject_id must be a UUID');
    res.status(201).json(await repository.add(subjectId, actor));
  });

  router.get('/', async (req, res) => {
    await admin.authorize(req);
    await read.authorize(req);
    res.json({ items: await repository.list() });
  });
  return router;
}
