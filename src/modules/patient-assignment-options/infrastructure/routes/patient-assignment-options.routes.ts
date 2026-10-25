import type { Request, Response } from 'express';
import { Router } from 'express';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { PatientAssignmentOptionsRepositoryPort } from '../../application/patient-assignment-options.ports.js';
import { PatientAssignmentOptionsService } from '../../application/patient-assignment-options.service.js';

function verifiedActor(getActor: (req: Request) => Promise<string | null>, req: Request): Promise<string> {
  return getActor(req).then(actor => {
    if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required');
    return actor;
  });
}

function uuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
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
  if (offset > 10000) throw new BadRequestError('offset must be between 0 and 10000');
  return { limit, offset };
}

export function createPatientAssignmentOptionsRouter({
  repository,
  writeGuard = new PermissionGuard('patient-assignments:write'),
  habilitationReadGuard = new PermissionGuard('student-habilitations:read'),
  getActor = defaultGetActor,
}: {
  repository: PatientAssignmentOptionsRepositoryPort;
  writeGuard?: Guard;
  habilitationReadGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const service = new PatientAssignmentOptionsService(repository);
  const authorize = async (req: Request) => {
    await writeGuard.authorize(req);
    await habilitationReadGuard.authorize(req);
    return verifiedActor(getActor, req);
  };

  router.get('/contexts', async (req: Request, res: Response) => {
    const actor = await authorize(req);
    const page = pagination(req.query);
    const items = await service.listContexts(actor, page.limit, page.offset);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ items: items.map(row => ({
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      academic_group_id: row.academic_group_id,
      academic_group_name: row.academic_group_name,
      academic_year: row.academic_year,
      curriculum_semester: row.curriculum_semester,
    })), ...page });
  });

  router.get('/students', async (req: Request, res: Response) => {
    const actor = await authorize(req);
    const subjectId = uuid(req.query.subject_id, 'subject_id');
    const academicGroupId = uuid(req.query.academic_group_id, 'academic_group_id');
    const page = pagination(req.query);
    const items = await service.listStudents(actor, subjectId, academicGroupId, page.limit, page.offset);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ items: items.map(row => ({
      student_habilitation_id: row.student_habilitation_id,
      student_id: row.student_id,
      nombres: row.nombres,
      apellidos: row.apellidos,
    })), ...page });
  });

  return router;
}
