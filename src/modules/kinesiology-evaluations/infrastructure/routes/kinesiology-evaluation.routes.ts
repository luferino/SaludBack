import type { Request, Response } from 'express';
import { Router } from 'express';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../../subject-groups/application/create-subject-group.usecase.js';
import { ageAtAdmission, dateOnly, validateDate } from '../../domain/evaluation.js';
import type { EvaluationRepositoryPort, EvaluationView as EvaluationRow } from '../../application/evaluation.ports.js';
import { EvaluationService } from '../../application/evaluation.service.js';

const MAX_BIGINT = 9223372036854775807n;

function evaluationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new BadRequestError('evaluation id must be a positive BIGINT decimal string');
  }
  return value;
}

function requireUuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) throw new BadRequestError(`${field} must be an object`);
  return value;
}

function verifiedActor(getActor: (request: Request) => Promise<string | null>, request: Request): Promise<string> {
  return getActor(request).then(actor => {
    if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required');
    return actor;
  });
}

function serialize(row: EvaluationRow) {
  const patient = row.patient;
  const projected = row;
  return {
    id: row.id,
    clinical_record_id: row.clinical_record_id,
    patient_id: row.patient_id,
    author_id: row.author_id,
    origin_student_habilitation_id: row.origin_student_habilitation_id,
    origin_subject_id: row.origin_subject_id,
    origin_group_id: row.origin_group_id,
    status: row.status ?? 'draft',
    ...(row.status === 'submitted' || row.status === 'validated' ? { validation_status: row.status === 'validated' ? 'validated' : 'pending_validation' } : {}),
    content: row.content,
    patient: patient ? {
      id: patient.id, documento: patient.documento, nombres: patient.nombres,
      apellidos: patient.apellidos, fecha_nacimiento: dateOnly(patient.fecha_nacimiento),
      email: patient.email, celular: patient.celular, sexo: patient.sexo, direccion: patient.direccion,
    } : null,
    age: projected.projected_submission_id
      ? projected.projected_age_at_admission ?? null
      : patient ? ageAtAdmission(patient.fecha_nacimiento, row.content.admission_date) : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    ...(projected.amendment_of_evaluation_id ? { amendment_of_evaluation_id: projected.amendment_of_evaluation_id } : {}),
    ...(projected.projected_submission_id ? {
      submission_id: projected.projected_submission_id,
      submission_ordinal: projected.projected_submission_ordinal,
      submitted_by: projected.projected_submitted_by,
      submitted_at: projected.projected_submitted_at && new Date(projected.projected_submitted_at).toISOString(),
      consent: projected.projected_consent,
    } : {}),
  };
}

function submissionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new BadRequestError('submission_id must be a positive BIGINT decimal string');
  }
  return value;
}

function queryUuid(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  return requireUuid(value, field);
}

export function createKinesiologyEvaluationRouter({
  repository,
  writeGuard = new PermissionGuard('kinesiology-evaluations:write'),
  readGuard = new PermissionGuard('kinesiology-evaluations:read'),
  getActor = defaultGetActor,
}: {
  repository: EvaluationRepositoryPort;
  writeGuard?: Guard;
  readGuard?: Guard;
  getActor?: (request: Request) => Promise<string | null>;
}): Router {
  const router = Router();
  const service = new EvaluationService(repository);

  router.post('/', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => !['patient_id', 'subject_id', 'academic_group_id', 'content'].includes(key))) {
      throw new BadRequestError('body may contain only patient_id, subject_id, academic_group_id and content');
    }
    const patientId = requireUuid(body.patient_id, 'patient_id');
    const subjectId = requireUuid(body.subject_id, 'subject_id');
    const groupId = requireUuid(body.academic_group_id, 'academic_group_id');
    response.status(201).json(serialize(await service.create(
      patientId, { subjectId, groupId }, body.content, actor,
    )));
  });

  router.post('/:id/amendments', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).length) throw new BadRequestError('body must be an empty object');
    response.status(201).json(serialize(await service.createAmendment(evaluationId(request.params.id), actor)));
  });

  router.post('/:id/submissions', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:submit').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).length) throw new BadRequestError('body must be an empty object');
    response.status(201).json(await service.submit(evaluationId(request.params.id), actor));
  });

  router.post('/:id/validations', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:review').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => key !== 'submission_id')) {
      throw new BadRequestError('body may contain only submission_id');
    }
    response.status(201).json(await service.validate(
      evaluationId(request.params.id), submissionId(body.submission_id), actor,
    ));
  });

  router.post('/:id/corrections', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:review').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => !['submission_id', 'reason'].includes(key))) {
      throw new BadRequestError('body may contain only submission_id and reason');
    }
    const target = submissionId(body.submission_id);
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      throw new BadRequestError('reason must be a non-empty string');
    }
    response.status(201).json(await service.requestCorrection(
      evaluationId(request.params.id), target, body.reason.trim(), actor,
    ));
  });

  router.get('/:id/corrections', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(await service.corrections(evaluationId(request.params.id), actor));
  });

  router.get('/:id/submissions', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(await service.submissions(evaluationId(request.params.id), actor));
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    await writeGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => key !== 'content')) throw new BadRequestError('body may contain only content');
    response.json(serialize(await service.edit(evaluationId(request.params.id), body.content, actor)));
  });

  router.get('/:id/consent', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(await service.consent(evaluationId(request.params.id), actor));
  });

  router.post('/:id/consent', async (request: Request, response: Response) => {
    await new PermissionGuard('kinesiology-evaluations:verify-consent').authorize(request);
    const actor = await verifiedActor(getActor, request);
    const body = requireObject(request.body, 'body');
    if (Object.keys(body).some(key => key !== 'paper_signature_date')) {
      throw new BadRequestError('body may contain only paper_signature_date');
    }
    const paperSignatureDate = validateDate(body.paper_signature_date, 'paper_signature_date');
    if (paperSignatureDate === null) throw new BadRequestError('paper_signature_date is required');
    response.status(201).json(await service.verifyConsent(evaluationId(request.params.id), paperSignatureDate, actor));
  });

  router.get('/:id', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    response.json(serialize(await service.detail(evaluationId(request.params.id), actor)));
  });

  router.get('/', async (request: Request, response: Response) => {
    await readGuard.authorize(request);
    const actor = await verifiedActor(getActor, request);
    const patientId = queryUuid(request.query.patient_id, 'patient_id', true)!;
    const subjectId = queryUuid(request.query.subject_id, 'subject_id', false);
    const groupId = queryUuid(request.query.academic_group_id, 'academic_group_id', false);
    response.json({ items: (await service.list(patientId, actor, subjectId, groupId)).map(serialize) });
  });
  return router;
}
