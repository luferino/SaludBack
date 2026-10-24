import type { Request, Response } from 'express';
import { Router } from 'express';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { Assignment as AssignmentRow } from '../../domain/patient-assignment.js';
import type { PatientAssignmentRepositoryPort } from '../../application/patient-assignment.ports.js';
import { PatientAssignmentService } from '../../application/patient-assignment.service.js';

function assignmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new BadRequestError('assignment id must be a positive BIGINT decimal string');
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}

function verifiedActor(getActor: (req: Request) => Promise<string | null>, req: Request): Promise<string> {
  return getActor(req).then((actor) => {
    if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required');
    return actor;
  });
}

function pagination(query: Request['query']): { limit: number; offset: number } {
  const integer = (value: unknown, fallback: number, field: string): number => {
    if (value === undefined) return fallback;
    if (Array.isArray(value) || typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new BadRequestError(`${field} must be an integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new BadRequestError(`${field} must be an integer`);
    return parsed;
  };
  const limit = integer(query.limit, 50, 'limit');
  const offset = integer(query.offset, 0, 'offset');
  if (limit < 1 || limit > 100) throw new BadRequestError('limit must be between 1 and 100');
  return { limit, offset };
}

function serialize(row: AssignmentRow) {
  return {
    id: row.id,
    patient_id: row.patient_id,
    student_habilitation_id: row.student_habilitation_id,
    subject_id: row.subject_id,
    academic_group_id: row.academic_group_id,
    assigned_by: row.assigned_by,
    assigned_at: new Date(row.assigned_at).toISOString(),
    ended_by: row.ended_by,
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    end_reason: row.end_reason,
    ...(row.nombres === undefined ? {} : {
      nombres: row.nombres,
      apellidos: row.apellidos,
      documento: row.documento,
    }),
  };
}

export function createPatientAssignmentRouter({
  repository,
  writeGuard = new PermissionGuard('patient-assignments:write'),
  readGuard = new PermissionGuard('patient-assignments:read'),
  ownGuard = new PermissionGuard('patient-assignments:read-own'),
  getActor = defaultGetActor,
}: {
  repository: PatientAssignmentRepositoryPort;
  writeGuard?: Guard;
  readGuard?: Guard;
  ownGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const service = new PatientAssignmentService(repository);

  router.post('/', async (req: Request, res: Response) => {
    await writeGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const row = await service.create({
      patientId: uuid(req.body?.patient_id, 'patient_id'),
      periodId: uuid(req.body?.student_habilitation_id, 'student_habilitation_id'),
      subjectId: uuid(req.body?.subject_id, 'subject_id'),
      groupId: uuid(req.body?.academic_group_id, 'academic_group_id'),
      actorId: actor,
    });
    res.status(201).json(serialize(row));
  });

  router.post('/:id/reassign', async (req: Request, res: Response) => {
    await writeGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const row = await service.reassign(assignmentId(req.params.id), {
      periodId: uuid(req.body?.student_habilitation_id, 'student_habilitation_id'),
      subjectId: uuid(req.body?.subject_id, 'subject_id'),
      groupId: uuid(req.body?.academic_group_id, 'academic_group_id'),
      actorId: actor,
    });
    res.status(200).json(serialize(row));
  });

  router.post('/:id/end', async (req: Request, res: Response) => {
    await writeGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const value = req.body?.end_reason;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestError('end_reason must be a non-empty string');
    }
    const row = await service.end(assignmentId(req.params.id), actor, value.trim());
    res.status(200).json(serialize(row));
  });

  router.get('/', async (req: Request, res: Response) => {
    await readGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const page = pagination(req.query);
    const items = await service.listTeacher(actor, page.limit, page.offset);
    res.status(200).json({ items: items.map(serialize), ...page });
  });

  router.get('/mine', async (req: Request, res: Response) => {
    await ownGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const page = pagination(req.query);
    const items = await service.listOwn(actor, page.limit, page.offset);
    res.status(200).json({ items: items.map(serialize), ...page });
  });

  return router;
}
