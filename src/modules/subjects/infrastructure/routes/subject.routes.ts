import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreateSubject } from '../../application/create-subject.usecase.js';
import { ListSubjects } from '../../application/list-subjects.usecase.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { SubjectRepositoryPort } from '../../application/subject.ports.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export function createSubjectRouter({
  repository,
  createGuard = new PermissionGuard('subjects:write'),
  listGuard = new PermissionGuard('subjects:read'),
  getActor = defaultGetActor,
}: {
  repository: SubjectRepositoryPort;
  createGuard?: Guard;
  listGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const createSubject = new CreateSubject({ repository });
  const listSubjects = new ListSubjects({ repository });

  router.post('/', async (req: Request, res: Response) => {
    await createGuard.authorize(req);
    const actor = await getActor(req);
    const subject = await createSubject.execute({
      name: req.body?.name,
      createdBy: actor,
    });
    res.status(201).json(subject.toJSON());
  });

  router.get('/', async (req: Request, res: Response) => {
    await listGuard.authorize(req);
    const result = await listSubjects.execute({
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.status(200).json({
      items: result.items.map((subject) => subject.toJSON()),
      limit: result.limit,
      offset: result.offset,
    });
  });

  return router;
}
