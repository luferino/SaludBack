import { Router } from 'express';
import { CreatePatient } from '../../application/create-patient.js';
import { OpenGuard } from '../../../shared/application/guard.js';

/**
 * Patient routes. The use case receives the injected repository; the guard
 * is the policy boundary in front of the endpoint (OpenGuard keeps alta
 * open until a `pacientes:write` guard replaces it at wiring time, PAT-005).
 * `getActor(req)` resolves the acting user for `created_by` attribution —
 * null today, since the open route mounts no auth middleware and
 * `authenticate` does not yet expose the token `sub` claim (PAT-004).
 */
export function createPatientRouter({ repository, guard = new OpenGuard(), getActor = defaultGetActor }) {
  const router = Router();
  const createPatient = new CreatePatient({ repository });

  router.post('/', async (req, res) => {
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
 *
 * @param {import('express').Request} req
 * @returns {Promise<string|null>}
 */
export async function defaultGetActor(req) {
  return req.auth?.sub ?? null;
}
