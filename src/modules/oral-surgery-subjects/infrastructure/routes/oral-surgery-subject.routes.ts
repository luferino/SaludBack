import { Router } from 'express';
import { AdminGuard, PermissionGuard } from '../../../shared/application/guard.js';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import type { OralSurgerySubjectRepositoryPort } from '../../application/subject-link.ports.js';

export function createOralSurgerySubjectRouter({ repository }: { repository: OralSurgerySubjectRepositoryPort }): Router {
  const router = Router();
  const admin = new AdminGuard();
  const read = new PermissionGuard('oral-surgery-subjects:read');
  const write = new PermissionGuard('oral-surgery-subjects:write');
  const readDrafts = new PermissionGuard('oral-surgery-drafts:read');

  router.get('/mine', async (req, res) => {
    await readDrafts.authorize(req);
    const actor = await defaultGetActor(req);
    if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required');
    const role = (req as AuthenticatedRequest).auth!.role;
    if (role !== 'estudiante' && role !== 'teacher') {
      throw new ForbiddenError('estudiante or teacher role required');
    }
    if (Object.keys(req.query).length > 0) throw new BadRequestError('query parameters are not supported');
    const contexts = await repository.listMine(actor, role);
    const items = contexts.map(({ subject_id, academic_group_id }) => ({ subject_id, academic_group_id }));
    res.setHeader('Cache-Control', 'no-store').json({ items });
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
    if (typeof subjectId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
      throw new BadRequestError('subject_id must be a UUID');
    }
    res.status(201).json(await repository.add(subjectId, actor));
  });

  router.get('/', async (req, res) => {
    await admin.authorize(req);
    await read.authorize(req);
    res.json({ items: await repository.list() });
  });
  return router;
}
