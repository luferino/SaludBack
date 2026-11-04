import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import type { EvolutionRepositoryPort, EvolutionView } from '../../application/evolution.ports.js';
import { EvolutionService } from '../../application/evolution.service.js';

const MAX_BIGINT = 9223372036854775807n;
const CREATE_FIELDS = ['patient_id', 'evaluation_id', 'subject_id', 'academic_group_id', 'content'];

function evolutionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new BadRequestError('evolution id must be a positive BIGINT decimal string');
  }
  return value;
}

function submissionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new BadRequestError('submission_id must be a positive BIGINT decimal string');
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestError('body must be an object');
  }
  return value as Record<string, unknown>;
}

async function verifiedActor(
  getActor: (request: Request) => Promise<string | null>,
  request: Request,
): Promise<string> {
  const actor = await getActor(request);
  if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required');
  return actor;
}

function serialize(row: EvolutionView) {
  return {
    id: row.id,
    clinical_record_id: row.clinical_record_id,
    evaluation_id: row.evaluation_id,
    patient_id: row.patient_id,
    author_id: row.author_id,
    origin_student_habilitation_id: row.origin_student_habilitation_id,
    origin_subject_id: row.origin_subject_id,
    origin_group_id: row.origin_group_id,
    ...(row.amendment_of_evolution_id ? { amendment_of_evolution_id: row.amendment_of_evolution_id } : {}),
    content: row.content,
    status: row.status,
    ...((row.status === 'submitted' || row.status === 'validated') ? { validation_status: row.status === 'validated' ? 'validated' : 'pending_validation' } : {}),
    ...(row.projected_submission_id ? { submission_id: row.projected_submission_id,
      submitted_by: row.projected_submitted_by,
      submitted_at: row.projected_submitted_at && new Date(row.projected_submitted_at).toISOString(),
      ...(row.projected_reviewed_by ? { reviewed_by: row.projected_reviewed_by,
        reviewed_at: row.projected_reviewed_at && new Date(row.projected_reviewed_at).toISOString() } : {}) } : {}),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export function createKinesiologyEvolutionRouter({
  repository,
  getActor = defaultGetActor,
  writeGuard = new PermissionGuard('kinesiology-evolutions:write'),
  readGuard = new PermissionGuard('kinesiology-evolutions:read'),
}: {
  repository: EvolutionRepositoryPort;
  getActor?: (request: Request) => Promise<string | null>;
  writeGuard?: Guard;
  readGuard?: Guard;
}): ExpressRouter {
  const router = Router();
  const service = new EvolutionService(repository);

  router.post('/', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body);
    if (Object.keys(body).some(key => !CREATE_FIELDS.includes(key))) {
      throw new BadRequestError(`body may contain only ${CREATE_FIELDS.join(', ')}`);
    }
    const evolution = await service.create({
      patientId: uuid(body.patient_id, 'patient_id'),
      evaluationId: evolutionId(body.evaluation_id),
      subjectId: uuid(body.subject_id, 'subject_id'),
      groupId: uuid(body.academic_group_id, 'academic_group_id'),
      content: body.content,
      actorId: actor,
    });
    response.status(201).json(serialize(evolution));
  });

  router.post('/:id/amendments', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    if (Object.keys(requireObject(request.body)).length) throw new BadRequestError('body must be an empty object');
    response.status(201).json(serialize(await service.createAmendment(evolutionId(request.params.id), actor)));
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body);
    if (Object.keys(body).some(key => key !== 'content')) {
      throw new BadRequestError('body may contain only content');
    }
    response.json(serialize(await service.edit(evolutionId(request.params.id), body.content, actor)));
  });

  router.post('/:id/submissions', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evolutions:submit').authorize(request);
    const actor = await verifiedActor(getActor, request);
    if (Object.keys(requireObject(request.body)).length) throw new BadRequestError('body must be an empty object');
    response.status(201).json(await service.submit(evolutionId(request.params.id), actor));
  });

  router.get('/:id/submissions', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    response.json(await service.submissions(evolutionId(request.params.id), await verifiedActor(getActor, request)));
  });

  router.post('/:id/corrections', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evolutions:review').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body);
    if (Object.keys(body).some(k => !['submission_id', 'reason'].includes(k))) {
      throw new BadRequestError('body may contain only submission_id and reason');
    }
    const targetSubmissionId = submissionId(body.submission_id);
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      throw new BadRequestError('reason must be a non-empty string');
    }
    response.status(201).json(await service.requestCorrection(evolutionId(request.params.id), targetSubmissionId, body.reason, actor));
  });

  router.get('/:id/corrections', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    response.json(await service.corrections(evolutionId(request.params.id), await verifiedActor(getActor, request)));
  });

  router.post('/:id/validations', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evolutions:review').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body);
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'submission_id')) {
      throw new BadRequestError('body must contain only submission_id');
    }
    response.status(201).json(await service.validate(evolutionId(request.params.id), submissionId(body.submission_id), actor));
  });

  router.get('/:id', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(serialize(await service.detail(evolutionId(request.params.id), actor)));
  });

  router.get('/', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const patientId = uuid(request.query.patient_id, 'patient_id');
    const subjectId = request.query.subject_id === undefined
      ? undefined : uuid(request.query.subject_id, 'subject_id');
    const groupId = request.query.academic_group_id === undefined
      ? undefined : uuid(request.query.academic_group_id, 'academic_group_id');
    const items = await service.list(patientId, actor, subjectId, groupId);
    response.json({ items: items.map(serialize) });
  });
  return router;
}
