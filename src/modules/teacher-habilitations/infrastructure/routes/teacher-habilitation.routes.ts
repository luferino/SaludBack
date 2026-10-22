import { Router } from 'express';
import type { Request, Response } from 'express';
import { ActivateTeacherHabilitation } from '../../application/activate-teacher-habilitation.usecase.js';
import { RevokeTeacherHabilitation } from '../../application/revoke-teacher-habilitation.usecase.js';
import { ListTeacherHabilitations } from '../../application/list-teacher-habilitations.usecase.js';
import type { TeacherHabilitationRepositoryPort } from '../../application/teacher-habilitation.ports.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export function createTeacherHabilitationRouter({
  repository,
  guard = new PermissionGuard('teacher-habilitations:write'),
  revokeGuard = new PermissionGuard('teacher-habilitations:revoke'),
  readGuard = new PermissionGuard('teacher-habilitations:read'),
  getActor = defaultGetActor,
}: {
  repository: TeacherHabilitationRepositoryPort;
  guard?: Guard;
  revokeGuard?: Guard;
  readGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const activateTeacherHabilitation = new ActivateTeacherHabilitation({ repository });
  const revokeTeacherHabilitation = new RevokeTeacherHabilitation({ repository });
  const listTeacherHabilitations = new ListTeacherHabilitations(repository);

  router.get('/', async (req: Request, res: Response) => {
    await readGuard.authorize(req);
    const result = await listTeacherHabilitations.execute({
      teacherId: req.query.teacher_id as unknown,
      subjectId: req.query.subject_id as unknown,
      academicGroupId: req.query.academic_group_id as unknown,
      status: req.query.status as unknown,
      limit: req.query.limit as unknown,
      offset: req.query.offset as unknown,
    });
    res.status(200).json({ items: result.items.map(serializeListing), limit: result.limit, offset: result.offset });
  });

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

  router.post('/:id/revoke', async (req: Request, res: Response) => {
    await revokeGuard.authorize(req);
    const actor = await getActor(req);
    const period = await revokeTeacherHabilitation.execute({ id: req.params.id, revokedBy: actor });
    res.status(200).json(period.toJSON());
  });

  return router;
}

function serializeListing(period: { id: string; teacherId?: string; subjectId?: string; academicGroupId?: string; activatedBy: string; activatedAt: Date | string; revokedBy: string | null; revokedAt: Date | string | null }) {
  return {
    id: period.id,
    teacher_id: period.teacherId,
    subject_id: period.subjectId,
    academic_group_id: period.academicGroupId,
    activated_by: period.activatedBy,
    activated_at: new Date(period.activatedAt).toISOString(),
    revoked_by: period.revokedBy,
    revoked_at: period.revokedAt === null ? null : new Date(period.revokedAt).toISOString(),
  };
}
