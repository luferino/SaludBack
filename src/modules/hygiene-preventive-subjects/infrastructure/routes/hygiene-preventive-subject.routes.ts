import { Router } from 'express';
import { AdminGuard, PermissionGuard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { HygienePreventiveSubjectRepositoryPort } from '../../application/subject-link.ports.js';

export function createHygienePreventiveSubjectRouter(
  { repository }: { repository: HygienePreventiveSubjectRepositoryPort },
): Router {
  const router = Router();
  const admin = new AdminGuard();
  const read = new PermissionGuard('hygiene-preventive-subjects:read');
  const write = new PermissionGuard('hygiene-preventive-subjects:write');

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
