import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreatePatient } from '../../application/create-patient.usecase.js';
import { AdminGuard, OpenGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { PatientRepositoryPort, PatientListingRepositoryPort, PatientPersonalDataRepositoryPort } from '../../application/patient.ports.js';
import { personalDataPatch } from '../../domain/personal-data.js';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { listSearchQuery } from '../../../shared/infrastructure/list-search-query.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Patient routes. The use case receives the injected repository; the guard
 * is the policy boundary in front of the endpoint (OpenGuard keeps alta
 * open until a `pacientes:write` guard replaces it at wiring time, PAT-005).
 * `getActor(req)` resolves the acting user for `created_by` attribution —
 * null on the open route (no auth middleware mounted), otherwise the
 * verified token `sub` claim when present (PAT-004).
 *
 * `PATCH /:id` is mounted only when `personalDataRepository` is given. It is
 * admin-only on top of `guard` (the `patients:write` permission) and changes
 * only marital status and medical insurance.
 */
export function createPatientRouter({
  repository,
  listRepository,
  personalDataRepository,
  guard = new OpenGuard(),
  getActor = defaultGetActor,
}: {
  repository: PatientRepositoryPort;
  listRepository?: PatientListingRepositoryPort;
  personalDataRepository?: PatientPersonalDataRepositoryPort;
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
      sexo: patient.sexo, direccion: patient.direccion, marital_status: patient.maritalStatus,
      medical_insurance: patient.medicalInsurance,
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

  if (personalDataRepository) router.patch('/:id', async (req: Request, res: Response) => {
    await guard.authorize(req);
    await new AdminGuard().authorize(req);
    const actor = await getActor(req);
    if (!actor || !UUID.test(actor)) throw new UnauthorizedError('A verified UUID actor is required');
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequestError('id must be a UUID');
    const patch = personalDataPatch(req.body);
    const patient = await personalDataRepository.updatePersonalData(id, patch, actor);
    if (!patient) throw new NotFoundError('patient was not found');
    res.status(200).json(patient.toJSON());
  });

  return router;
}
