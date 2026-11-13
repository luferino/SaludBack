import type { Request, Response } from 'express';
import { Router } from 'express';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { PatientAvailability } from '../../domain/patient-availability.js';
import type { PatientAvailabilityRepositoryPort } from '../../application/patient-availability.ports.js';
import { PatientAvailabilityService } from '../../application/patient-availability.service.js';

function uuid(value: unknown, field: string): string { if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`); return value; }
function assignableFilter(value: unknown): boolean { if (value === undefined || value === 'false') return false; if (value === 'true') return true; throw new BadRequestError('assignable must be true or false'); }
function pagination(query: Request['query']) {
  const parse = (value: unknown, fallback: number, key: string) => {
    if (value === undefined) return fallback;
    if (Array.isArray(value) || typeof value !== 'string' || !/^\d+$/.test(value)) throw new BadRequestError(`${key} must be an integer`);
    const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new BadRequestError(`${key} must be an integer`); return n;
  };
  const limit = parse(query.limit, 50, 'limit'), offset = parse(query.offset, 0, 'offset');
  if (limit < 1 || limit > 100) throw new BadRequestError('limit must be between 1 and 100');
  if (offset > 10000) throw new BadRequestError('offset must be between 0 and 10000');
  return { limit, offset };
}
function actorId(getActor: (req: Request) => Promise<string | null>, req: Request): Promise<string> {
  return getActor(req).then(actor => { if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required'); return actor; });
}
function serialize(row: PatientAvailability) { return {
  id: row.id, patient_id: row.patient_id, subject_id: row.subject_id, academic_group_id: row.academic_group_id,
  enabled_by: row.enabled_by, enabled_at: new Date(row.enabled_at).toISOString(), withdrawn_by: row.withdrawn_by,
  withdrawn_at: row.withdrawn_at ? new Date(row.withdrawn_at).toISOString() : null,
}; }

export function createPatientAvailabilityRouter({ repository, manageGuard = new PermissionGuard('patient-availabilities:manage'), readGuard = new PermissionGuard('patient-availabilities:read'), assignmentGuard = new PermissionGuard('patient-assignments:write'), getActor = defaultGetActor }: {
  repository: PatientAvailabilityRepositoryPort; manageGuard?: Guard; readGuard?: Guard; assignmentGuard?: Guard; getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router(), service = new PatientAvailabilityService(repository);
  router.post('/', async (req: Request, res: Response) => {
    await manageGuard.authorize(req); const actor = await actorId(getActor, req);
    const row = await service.enable({ patientId: uuid(req.body?.patient_id, 'patient_id'), subjectId: uuid(req.body?.subject_id, 'subject_id'), groupId: uuid(req.body?.academic_group_id, 'academic_group_id'), actorId: actor });
    res.status(201).json(serialize(row));
  });
  router.post('/:id/withdraw', async (req: Request, res: Response) => {
    await manageGuard.authorize(req); const actor = await actorId(getActor, req);
    res.status(200).json(serialize(await service.withdraw(uuid(req.params.id, 'id'), actor)));
  });
  router.get('/manage', async (req: Request, res: Response) => {
    await manageGuard.authorize(req); const page = pagination(req.query), patientId = uuid(req.query.patient_id, 'patient_id');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ items: (await service.history(patientId, page.limit, page.offset)).map(serialize), ...page });
  });
  router.post('/patient-search', async (req: Request, res: Response) => {
    await manageGuard.authorize(req);
    if (typeof req.body?.documento !== 'string' || !req.body.documento.trim()) throw new BadRequestError('documento must be a non-empty string');
    res.setHeader('Cache-Control', 'no-store');
    const items = await service.searchPatient(req.body.documento.trim());
    res.status(200).json({ items: items.map(({ patient_id, nombres, apellidos }) => ({ patient_id, nombres, apellidos })) });
  });
  router.get('/', async (req: Request, res: Response) => {
    await readGuard.authorize(req); await assignmentGuard.authorize(req); const actor = await actorId(getActor, req), page = pagination(req.query);
    const subjectId = uuid(req.query.subject_id, 'subject_id'), groupId = uuid(req.query.academic_group_id, 'academic_group_id'), assignable = assignableFilter(req.query.assignable);
    res.setHeader('Cache-Control', 'no-store');
    const items = await service.listTeacher(actor, subjectId, groupId, page.limit, page.offset, assignable);
    res.status(200).json({ items: items.map(({ patient_id, nombres, apellidos }) => ({ patient_id, nombres, apellidos })), ...page });
  });
  return router;
}
