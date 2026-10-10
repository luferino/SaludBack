import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreateSubjectGroup } from '../../application/create-subject-group.usecase.js';
import { ListSubjectGroups } from '../../application/list-subject-groups.usecase.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { SubjectGroupRepositoryPort } from '../../application/subject-group.ports.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export function createSubjectGroupRouter({
  repository,
  createGuard = new PermissionGuard('subject-groups:write'),
  listGuard = new PermissionGuard('subject-groups:read'),
  getActor = defaultGetActor,
}: {
  repository: SubjectGroupRepositoryPort;
  createGuard?: Guard;
  listGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const createSubjectGroup = new CreateSubjectGroup({ repository });
  const listSubjectGroups = new ListSubjectGroups({ repository });

  router.post('/', async (req: Request, res: Response) => {
    await createGuard.authorize(req);
    const actor = await getActor(req);
    const association = await createSubjectGroup.execute({
      subject_id: req.body?.subject_id,
      academic_group_id: req.body?.academic_group_id,
      createdBy: actor,
    });
    res.status(201).json(association.toJSON());
  });

  router.get('/', async (req: Request, res: Response) => {
    await listGuard.authorize(req);
    const result = await listSubjectGroups.execute({
      subject_id: req.query.subject_id,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.status(200).json({
      items: result.items.map((association) => association.toJSON()),
      limit: result.limit,
      offset: result.offset,
    });
  });

  return router;
}
