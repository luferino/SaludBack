import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreateGroup } from '../../application/create-group.usecase.js';
import { ListGroups } from '../../application/list-groups.usecase.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { GroupRepositoryPort } from '../../application/group.ports.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export function createGroupRouter({
  repository,
  createGuard = new PermissionGuard('groups:write'),
  listGuard = new PermissionGuard('groups:read'),
  getActor = defaultGetActor,
}: {
  repository: GroupRepositoryPort;
  createGuard?: Guard;
  listGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const createGroup = new CreateGroup({ repository });
  const listGroups = new ListGroups({ repository });

  router.post('/', async (req: Request, res: Response) => {
    await createGuard.authorize(req);
    const actor = await getActor(req);
    const group = await createGroup.execute({
      academic_year: req.body?.academic_year,
      curriculum_semester: req.body?.curriculum_semester,
      name: req.body?.name,
      createdBy: actor,
    });
    res.status(201).json(group.toJSON());
  });

  router.get('/', async (req: Request, res: Response) => {
    await listGuard.authorize(req);
    const result = await listGroups.execute({
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.status(200).json({
      items: result.items.map((group) => group.toJSON()),
      limit: result.limit,
      offset: result.offset,
    });
  });

  return router;
}
