import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreateTeacher } from '../../application/create-teacher.usecase.js';
import { OpenGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { TeacherRepositoryPort } from '../../application/teacher.ports.js';
import type { UserRepositoryPort, PasswordHasherPort } from '../../../auth/application/auth.ports.js';
import type { UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import type { AuthenticatedRequest } from '../../../auth/infrastructure/middleware/authenticate.js';

/**
 * Teacher routes. The use case receives the injected repositories,
 * hasher, and unit of work; the guard is the policy boundary in front of
 * the endpoint (OpenGuard keeps alta open until a policy guard replaces
 * it at wiring time, TEA-004). `getActor(req)` resolves the acting user
 * for `created_by` attribution — null on the open route (no auth
 * middleware mounted), otherwise the verified token `sub` claim when
 * present (AUD-003). The router is defined here but mounted into the
 * app by wiring (index.ts, PR 4).
 */
export function createTeacherRouter({
  repository,
  userRepository,
  hasher,
  unitOfWork,
  guard = new OpenGuard(),
  getActor = defaultGetActor,
}: {
  repository: TeacherRepositoryPort;
  userRepository: UserRepositoryPort;
  hasher: PasswordHasherPort;
  unitOfWork: UnitOfWorkPort;
  guard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const createTeacher = new CreateTeacher({
    teacherRepository: repository,
    userRepository,
    hasher,
    unitOfWork,
  });

  router.post('/', async (req: Request, res: Response) => {
    await guard.authorize(req);
    const actor = await getActor(req);
    const teacher = await createTeacher.execute({
      ...req.body,
      createdBy: actor,
    });
    res.status(201).json(teacher.toJSON());
  });

  return router;
}

/**
 * Default actor hook: reads the verified token subject from `req.auth`,
 * preferring the `userId` alias and falling back to `sub` (both are set
 * by `authenticate` when the token carries a `sub` claim — AUTH-002).
 * Resolves to null when `req.auth` is unset (open route) or lacks a
 * subject (TEA-004); a guard or token middleware can set the seam
 * without changing the contract.
 */
export async function defaultGetActor(req: Request): Promise<string | null> {
  const authReq = req as AuthenticatedRequest;
  return authReq.auth?.userId ?? authReq.auth?.sub ?? null;
}