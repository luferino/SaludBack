import { Router } from 'express';
import type { Request, Response, Router as ExpressRouter } from 'express';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { EvolutionRepositoryPort, EvolutionView } from '../../application/evolution.ports.js';
import { EvolutionService } from '../../application/evolution.service.js';

const MAX_BIGINT = 9223372036854775807n;
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_BIGINT) throw new BadRequestError('evolution id must be a positive BIGINT decimal string');
  return value;
}
function uuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BadRequestError('body must be an object');
  return value as Record<string, unknown>;
}
async function actor(getActor: (request: Request) => Promise<string | null>, request: Request): Promise<string> {
  const value = await getActor(request);
  if (!isCanonicalUuid(value)) throw new UnauthorizedError('A verified UUID actor is required');
  return value;
}
function serialize(row: EvolutionView) {
  return { id: row.id, clinical_record_id: row.clinical_record_id, evaluation_id: row.evaluation_id,
    patient_id: row.patient_id, author_id: row.author_id, origin_student_habilitation_id: row.origin_student_habilitation_id,
    origin_subject_id: row.origin_subject_id, origin_group_id: row.origin_group_id, content: row.content, status: row.status,
    created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() };
}
function queryUuid(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  return uuid(value, field);
}

export function createKinesiologyEvolutionRouter({
  repository, getActor = defaultGetActor,
  writeGuard = new PermissionGuard('kinesiology-evolutions:write'),
  readGuard = new PermissionGuard('kinesiology-evolutions:read'),
}: { repository: EvolutionRepositoryPort; getActor?: (request: Request) => Promise<string | null>; writeGuard?: Guard; readGuard?: Guard }): ExpressRouter {
  const router = Router();
  const service = new EvolutionService(repository);
  router.post('/', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const user = await actor(getActor, request);
    const body = object(request.body);
    const allowed = ['patient_id', 'evaluation_id', 'subject_id', 'academic_group_id', 'content'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestError(`body may contain only ${allowed.join(', ')}`);
    const row = await service.create({ patientId: uuid(body.patient_id, 'patient_id'), evaluationId: id(body.evaluation_id),
      subjectId: uuid(body.subject_id, 'subject_id'), groupId: uuid(body.academic_group_id, 'academic_group_id'), content: body.content, actorId: user });
    response.status(201).json(serialize(row));
  });
  router.patch('/:id', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const user = await actor(getActor, request);
    const body = object(request.body);
    if (Object.keys(body).some(key => key !== 'content')) throw new BadRequestError('body may contain only content');
    response.json(serialize(await service.edit(id(request.params.id), body.content, user)));
  });
  router.get('/:id', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    response.json(serialize(await service.detail(id(request.params.id), await actor(getActor, request))));
  });
  router.get('/', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const user = await actor(getActor, request);
    const patientId = queryUuid(request.query.patient_id, 'patient_id', true)!;
    const subjectId = queryUuid(request.query.subject_id, 'subject_id');
    const groupId = queryUuid(request.query.academic_group_id, 'academic_group_id');
    response.json({ items: (await service.list(patientId, user, subjectId, groupId)).map(serialize) });
  });
  return router;
}
