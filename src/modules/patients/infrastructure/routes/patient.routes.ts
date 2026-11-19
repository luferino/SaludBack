import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreatePatient } from '../../application/create-patient.usecase.js';
import { AdminGuard, OpenGuard, PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import type { PatientRepositoryPort, PatientListingRepositoryPort, PatientPersonalDataRepositoryPort, PatientPersonalDataAccessRepositoryPort, PersonalDataRecord } from '../../application/patient.ports.js';
import { personalDataPatch } from '../../domain/personal-data.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../../shared/domain/errors.js';
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
 *
 * `GET /:id/personal-data` and `PATCH /:id/personal-data` are mounted only when
 * `personalDataAccessRepository` is given. They serve estudiante and teacher
 * (read) and estudiante (write) under their own permissions; the repository
 * decides access per patient, and every miss answers the same 404.
 */
export function createPatientRouter({
  repository,
  listRepository,
  personalDataRepository,
  personalDataAccessRepository,
  guard = new OpenGuard(),
  getActor = defaultGetActor,
}: {
  repository: PatientRepositoryPort;
  listRepository?: PatientListingRepositoryPort;
  personalDataRepository?: PatientPersonalDataRepositoryPort;
  personalDataAccessRepository?: PatientPersonalDataAccessRepositoryPort;
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

  if (personalDataAccessRepository) {
    router.get('/:id/personal-data', async (req: Request, res: Response) => {
      await new PermissionGuard('patient-personal-data:read').authorize(req);
      const role = (req as AuthenticatedRequest).auth!.role;
      if (role !== 'estudiante' && role !== 'teacher') throw new ForbiddenError('estudiante or teacher role required');
      const actor = await getActor(req);
      if (!actor || !UUID.test(actor)) throw new UnauthorizedError('A verified UUID actor is required');
      const id = req.params.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequestError('id must be a UUID');
      if (Object.keys(req.query).length > 0) throw new BadRequestError('query parameters are not supported');
      const record = await personalDataAccessRepository.readPersonalData(id, { id: actor, role });
      if (!record) throw new NotFoundError('patient was not found');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(personalDataView(record));
    });

    router.patch('/:id/personal-data', async (req: Request, res: Response) => {
      await new PermissionGuard('patient-personal-data:write').authorize(req);
      const role = (req as AuthenticatedRequest).auth!.role;
      if (role !== 'estudiante') throw new ForbiddenError('student role required');
      const actor = await getActor(req);
      if (!actor || !UUID.test(actor)) throw new UnauthorizedError('A verified UUID actor is required');
      const id = req.params.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequestError('id must be a UUID');
      const patch = personalDataPatch(req.body);
      const record = await personalDataAccessRepository.updateAsStudent(id, patch, { id: actor, role });
      if (!record) throw new NotFoundError('patient was not found');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(personalDataView(record));
    });
  }

  return router;
}

// The student and teacher projection: identity header plus the two personal-data fields, in this key order.
function personalDataView(record: PersonalDataRecord) {
  return {
    id: record.id, documento: record.documento, nombres: record.nombres, apellidos: record.apellidos,
    fecha_nacimiento: record.fechaNacimiento, sexo: record.sexo, direccion: record.direccion,
    marital_status: record.maritalStatus, medical_insurance: record.medicalInsurance,
  };
}
