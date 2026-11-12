import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreatePatient } from '../../application/create-patient.usecase.js';
import { AdminGuard, OpenGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { PatientRepositoryPort, PatientListingRepositoryPort } from '../../application/patient.ports.js';
import { listSearchQuery } from '../../../shared/infrastructure/list-search-query.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

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
  listRepository,
  guard = new OpenGuard(),
  getActor = defaultGetActor,
}: {
  repository: PatientRepositoryPort;
  listRepository?: PatientListingRepositoryPort;
  guard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const createPatient = new CreatePatient({ repository });

  if (listRepository) router.get('/', async (req: Request, res: Response) => {
    await new AdminGuard().authorize(req);
    const { q, limit, offset } = listSearchQuery(req, 50);
    const patients = await listRepository.list({ q, limit, offset });
    const items = patients.map(patient => ({
      id: patient.id, documento: patient.documento, nombres: patient.nombres, apellidos: patient.apellidos,
      fecha_nacimiento: patient.fechaNacimiento || null, email: patient.email, celular: patient.celular,
      sexo: patient.sexo, direccion: patient.direccion,
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ items, limit, offset });
  });

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
