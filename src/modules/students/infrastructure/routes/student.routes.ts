import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreateStudent } from '../../application/create-student.usecase.js';
import { OpenGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { StudentRepositoryPort } from '../../application/student.ports.js';
import type { UserRepositoryPort, PasswordHasherPort } from '../../../auth/application/auth.ports.js';
import type { UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

/**
 * Student routes. The use case receives the injected repositories,
 * hasher, and unit of work; the guard is the policy boundary in front of
 * the endpoint (OpenGuard keeps alta open until a policy guard replaces
 * it at wiring time, STU-005). `getActor(req)` resolves the acting user
 * for `created_by` attribution — null on the open route (no auth
 * middleware mounted), otherwise the verified token `sub` claim when
 * present (AUD-003). The router is defined here but mounted into the
 * app by wiring (index.ts, PR 4).
 */
export function createStudentRouter({
  repository,
  userRepository,
  hasher,
  unitOfWork,
  guard = new OpenGuard(),
  getActor = defaultGetActor,
}: {
  repository: StudentRepositoryPort;
  userRepository: UserRepositoryPort;
  hasher: PasswordHasherPort;
  unitOfWork: UnitOfWorkPort;
  guard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const createStudent = new CreateStudent({
    studentRepository: repository,
    userRepository,
    hasher,
    unitOfWork,
  });

  router.post('/', async (req: Request, res: Response) => {
    await guard.authorize(req);
    const actor = await getActor(req);
    const student = await createStudent.execute({
      ...req.body,
      createdBy: actor,
    });
    res.status(201).json(student.toJSON());
  });

  return router;
}