import { Router } from 'express';
import type { Request, Response } from 'express';
import { ActivateStudentHabilitation } from '../../application/activate-student-habilitation.usecase.js';
import { RevokeStudentHabilitation } from '../../application/revoke-student-habilitation.usecase.js';
import { ListStudentHabilitations } from '../../application/list-student-habilitations.usecase.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import type { StudentHabilitationRepositoryPort } from '../../application/student-habilitation.ports.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export function createStudentHabilitationRouter({ repository, guard = new PermissionGuard('student-habilitations:write'), revokeGuard = new PermissionGuard('student-habilitations:revoke'), readGuard = new PermissionGuard('student-habilitations:read'), getActor = defaultGetActor }: {
  repository: StudentHabilitationRepositoryPort;
  guard?: Guard;
  revokeGuard?: Guard;
  readGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const activate = new ActivateStudentHabilitation(repository);
  const revoke = new RevokeStudentHabilitation(repository);
  const list = new ListStudentHabilitations(repository);
  router.get('/', async (req: Request, res: Response) => {
    await readGuard.authorize(req);
    const actor = await getActor(req);
    const auth = (req as AuthenticatedRequest).auth;
    const result = await list.execute({
      studentId: req.query.student_id as unknown,
      subjectId: req.query.subject_id as unknown,
      academicGroupId: req.query.academic_group_id as unknown,
      status: req.query.status as unknown,
      limit: req.query.limit as unknown,
      offset: req.query.offset as unknown,
      actorId: actor,
      isAdmin: auth?.role === 'admin',
    });
    res.status(200).json({ items: result.items.map(serializeListing), limit: result.limit, offset: result.offset });
  });
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

function serializeListing(period: { id: string; studentId: string; subjectId: string; academicGroupId: string; activatedBy: string; activatedAt: Date | string; revokedBy: string | null; revokedAt: Date | string | null }) {
  return {
    id: period.id,
    student_id: period.studentId,
    subject_id: period.subjectId,
    academic_group_id: period.academicGroupId,
    activated_by: period.activatedBy,
    activated_at: new Date(period.activatedAt).toISOString(),
    revoked_by: period.revokedBy,
    revoked_at: period.revokedAt === null ? null : new Date(period.revokedAt).toISOString(),
  };
}
