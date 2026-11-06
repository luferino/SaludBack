import { Router } from 'express';
import type { Request } from 'express';
import { PermissionGuard } from '../../shared/application/guard.js';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../shared/domain/errors.js';
import type { AuthenticatedRequest } from '../../shared/application/authenticated-request.js';
import { defaultGetActor } from '../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import { object, validateContent } from '../domain/content.js';
import type { DraftActor, DraftRepositoryPort, DraftRow } from '../application/draft.ports.js';

const MAX_BIGINT = 9223372036854775807n;
function decimal(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new BadRequestError(`${name} must be a positive BIGINT decimal string`);
  }
  return value;
}
function uuid(value: unknown, name: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${name} must be a UUID`);
  return value;
}
function keys(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestError(`allowed fields: ${allowed.join(', ')}`);
}
async function actor(req: Request, write: boolean): Promise<DraftActor> {
  await new PermissionGuard(`oral-surgery-drafts:${write ? 'write' : 'read'}`).authorize(req);
  const id = await defaultGetActor(req);
  if (!isCanonicalUuid(id)) throw new UnauthorizedError('A verified UUID actor is required');
  const role = (req as AuthenticatedRequest).auth!.role;
  if (write && role !== 'estudiante') throw new ForbiddenError('student author role required');
  if (!['admin', 'teacher', 'estudiante'].includes(role)) throw new ForbiddenError('clinical role required');
  return { id, role };
}
function serialize(row: DraftRow) {
  return { ...row, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() };
}
function page(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) > max || (name === 'limit' && value === '0')) {
    throw new BadRequestError(`${name} is out of range`);
  }
  return Number(value);
}

export function createOralSurgeryDraftRouter({ repository }: { repository: DraftRepositoryPort }): Router {
  const router = Router();
  router.post('/:id/authorizations', async (req, res) => {
    await new PermissionGuard('oral-surgery-drafts:authorize').authorize(req);
    const id = await defaultGetActor(req);
    if (!isCanonicalUuid(id)) throw new UnauthorizedError('A verified UUID actor is required');
    const role = (req as AuthenticatedRequest).auth!.role;
    if (role !== 'teacher') throw new ForbiddenError('teacher instructor role required');
    const body = object(req.body, 'body');
    keys(body, ['expected_version', 'consent_declaration_id', 'paper_consent_verified']);
    if (body.paper_consent_verified !== true) throw new BadRequestError('paper_consent_verified must be true to authorize surgery');
    res.status(201).json(await repository.authorizeSurgery(decimal(req.params.id, 'draft id'),
      decimal(body.expected_version, 'expected_version'), decimal(body.consent_declaration_id, 'consent_declaration_id'), { id, role }));
  });
  router.get('/:id/authorizations', async (req, res) => {
    const who = await actor(req, false);
    res.json(await repository.authorizationHistory(decimal(req.params.id, 'draft id'), who));
  });
  router.post('/:id/consent', async (req, res) => {
    const who = await actor(req, true);
    const body = object(req.body, 'body');
    keys(body, ['expected_version', 'paper_signed']);
    if (body.paper_signed !== true) throw new BadRequestError('paper_signed must be true to attest signed paper consent');
    const result = await repository.declareConsent(decimal(req.params.id, 'draft id'),
      decimal(body.expected_version, 'expected_version'), who);
    res.status(201).json(result);
  });
  router.get('/:id/consent', async (req, res) => {
    const who = await actor(req, false);
    res.json(await repository.consentHistory(decimal(req.params.id, 'draft id'), who));
  });
  router.post('/', async (req, res) => {
    const who = await actor(req, true);
    const body = object(req.body, 'body');
    keys(body, ['patient_id', 'subject_id', 'academic_group_id', 'content']);
    const result = await repository.create({
      patientId: uuid(body.patient_id, 'patient_id'), subjectId: uuid(body.subject_id, 'subject_id'),
      groupId: uuid(body.academic_group_id, 'academic_group_id'),
      content: validateContent(body.content === undefined ? {} : body.content),
    }, who);
    res.status(201).json(serialize(result));
  });
  router.get('/', async (req, res) => {
    const who = await actor(req, false);
    keys(req.query, ['patient_id', 'subject_id', 'academic_group_id', 'limit', 'offset']);
    const optionalUuid = (name: string) => req.query[name] === undefined ? undefined : uuid(req.query[name], name);
    const items = await repository.list({
      patientId: optionalUuid('patient_id'), subjectId: optionalUuid('subject_id'),
      groupId: optionalUuid('academic_group_id'), limit: page(req.query.limit, 'limit', 50, 100),
      offset: page(req.query.offset, 'offset', 0, 2147483647),
    }, who);
    res.json({ items: items.map(serialize) });
  });
  router.get('/:id', async (req, res) => {
    const who = await actor(req, false);
    res.json(serialize(await repository.get(decimal(req.params.id, 'draft id'), who)));
  });
  router.patch('/:id', async (req, res) => {
    const who = await actor(req, true);
    const body = object(req.body, 'body');
    keys(body, ['content', 'expected_version']);
    res.json(serialize(await repository.edit(decimal(req.params.id, 'draft id'),
      decimal(body.expected_version, 'expected_version'), validateContent(body.content), who)));
  });
  return router;
}
