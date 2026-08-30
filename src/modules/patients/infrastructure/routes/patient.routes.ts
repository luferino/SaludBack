import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreatePatient } from '../../application/create-patient.usecase.js';
import { OpenGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { PatientRepositoryPort } from '../../application/patient.ports.js';
import type { AuthenticatedRequest } from '../../../auth/infrastructure/middleware/authenticate.js';

/**
 * Patient routes. The use case receives the injected repository; the guard
 * is the policy boundary in front of the endpoint (OpenGuard keeps alta
 * open until a `pacientes:write` guard replaces it at wiring time, PAT-005).
 * `getActor(req)` resolves the acting user for `created_by` attribution —
 * null on the open route (no auth middleware mounted), otherwise the
 * verified token `sub` claim when present (PAT-004).
 */
export function createPatientRouter({
  repository,
  guard = new OpenGuard(),
  getActor = defaultGetActor,
}: {
  repository: PatientRepositoryPort;
  guard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const createPatient = new CreatePatient({ repository });

  router.post('/', async (req: Request, res: Response) => {
    await guard.authorize(req);
    const actor = await getActor(req);
    const patient = await createPatient.execute({
      ...req.body,
      createdBy: actor,
    });
    res.status(201).json(patient.toJSON());
  });

  return router;
}

/**
 * Default actor hook: reads the verified token subject from `req.auth.sub`.
 * Resolves to null when `req.auth` is unset (open route) or lacks a `sub`
 * claim; when a guard or token middleware sets it, the seam surfaces the
 * actor with no contract change (PAT-004).
 */
export async function defaultGetActor(req: Request): Promise<string | null> {
  const authReq = req as AuthenticatedRequest;
  return authReq.auth?.sub ?? null;
}
