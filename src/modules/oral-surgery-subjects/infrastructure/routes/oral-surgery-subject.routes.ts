import { Router } from 'express';
import { AdminGuard, PermissionGuard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import type { OralSurgerySubjectRepositoryPort } from '../../application/subject-link.ports.js';

export function createOralSurgerySubjectRouter({ repository }: { repository: OralSurgerySubjectRepositoryPort }): Router {
  const router = Router();
  const admin = new AdminGuard();
  const read = new PermissionGuard('oral-surgery-subjects:read');
  const write = new PermissionGuard('oral-surgery-subjects:write');

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
