import { Router } from 'express';
import type { Request, Response } from 'express';
import { ActivateStudentHabilitation } from '../../application/activate-student-habilitation.usecase.js';
import { RevokeStudentHabilitation } from '../../application/revoke-student-habilitation.usecase.js';
import type { StudentHabilitationRepositoryPort } from '../../application/student-habilitation.ports.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export function createStudentHabilitationRouter({ repository, guard = new PermissionGuard('student-habilitations:write'), revokeGuard = new PermissionGuard('student-habilitations:revoke'), getActor = defaultGetActor }: {
  repository: StudentHabilitationRepositoryPort;
  guard?: Guard;
  revokeGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const activate = new ActivateStudentHabilitation(repository);
  const revoke = new RevokeStudentHabilitation(repository);
  router.post('/', async (req: Request, res: Response) => {
    await guard.authorize(req);
    const period = await activate.execute({ student_id: req.body?.student_id, subject_id: req.body?.subject_id, academic_group_id: req.body?.academic_group_id, activatedBy: await getActor(req) });
    res.status(201).json(period.toJSON());
  });
  router.post('/:id/revoke', async (req: Request, res: Response) => {
    await revokeGuard.authorize(req);
    const period = await revoke.execute({ id: req.params.id, revokedBy: await getActor(req) });
    res.status(200).json(period.toJSON());
  });
  return router;
}
