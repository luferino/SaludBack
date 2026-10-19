import { Router } from 'express';
import type { Request, Response } from 'express';
import { ActivateTeacherHabilitation } from '../../application/activate-teacher-habilitation.usecase.js';
import type { TeacherHabilitationRepositoryPort } from '../../application/teacher-habilitation.ports.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export function createTeacherHabilitationRouter({
  repository,
  guard = new PermissionGuard('teacher-habilitations:write'),
  getActor = defaultGetActor,
}: {
  repository: TeacherHabilitationRepositoryPort;
  guard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const activateTeacherHabilitation = new ActivateTeacherHabilitation({ repository });

  router.post('/', async (req: Request, res: Response) => {
    await guard.authorize(req);
    const actor = await getActor(req);
    const period = await activateTeacherHabilitation.execute({
      teacher_id: req.body?.teacher_id,
      subject_id: req.body?.subject_id,
      academic_group_id: req.body?.academic_group_id,
      activatedBy: actor,
    });
    res.status(201).json(period.toJSON());
  });

  return router;
}
