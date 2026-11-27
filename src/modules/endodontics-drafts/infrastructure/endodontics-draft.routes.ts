import { Router } from 'express';
import type { Request } from 'express';
import { PermissionGuard } from '../../shared/application/guard.js';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../shared/domain/errors.js';
import type { AuthenticatedRequest } from '../../shared/application/authenticated-request.js';
import { defaultGetActor } from '../../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import { object, validateContent } from '../domain/content.js';
import { validateTreatmentContent } from '../domain/treatment-content.js';
import type { DraftActor, DraftRepositoryPort, DraftRow } from '../application/draft.ports.js';
import type { TreatmentReportRepositoryPort, TreatmentReportRow } from '../application/treatment-report.ports.js';
const MAX_BIGINT = 9223372036854775807n;
function decimal(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > MAX_BIGINT) throw new BadRequestError(`${name} must be a positive BIGINT decimal string`);
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new BadRequestError(`allowed fields: ${allowed.join(', ')}`);
}
async function actor(req: Request, write: boolean): Promise<DraftActor> {
  await new PermissionGuard(`endodontics-drafts:${write ? 'write' : 'read'}`).authorize(req);
  const id = await defaultGetActor(req);
  if (!isCanonicalUuid(id)) throw new UnauthorizedError('A verified UUID actor is required');
  const role = (req as AuthenticatedRequest).auth!.role;
  if (write && role !== 'estudiante') throw new ForbiddenError('student author role required');
  if (!['admin', 'teacher', 'estudiante'].includes(role)) throw new ForbiddenError('clinical role required');
  return { id, role };
}
function serialize(row: DraftRow) { return { ...row, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() }; }
function serializeReport(row: TreatmentReportRow) {
  const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
  return { ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at), closed_at: iso(row.closed_at) };
}
export function createEndodonticsDraftRouter({ repository }: { repository: DraftRepositoryPort & TreatmentReportRepositoryPort }): Router {
  const router = Router();
  router.post('/', async (req, res) => {
    const who = await actor(req, true); const body = object(req.body, 'body');
    keys(body, ['patient_id','subject_id','academic_group_id','content']);
    for (const key of ['patient_id','subject_id','academic_group_id']) if (!isCanonicalUuid(body[key])) throw new BadRequestError(`${key} must be a UUID`);
    const result = await repository.create({ patientId: body.patient_id as string, subjectId: body.subject_id as string,
      groupId: body.academic_group_id as string, content: validateContent(body.content ?? {}) }, who);
    res.status(201).json(serialize(result));
  });
  router.get('/', async (req, res) => {
    const who = await actor(req, false); const rows = await repository.list({ limit: 50, offset: 0 }, who);
    res.json({ items: rows.map(serialize) });
  });
  router.get('/:id', async (req, res) => res.json(serialize(await repository.get(decimal(req.params.id, 'draft id'), await actor(req, false)))));
  router.patch('/:id', async (req, res) => {
    const who = await actor(req, true); const body = object(req.body, 'body'); keys(body, ['content','expected_version']);
    const result = await repository.edit(decimal(req.params.id, 'draft id'), decimal(body.expected_version, 'expected_version'), validateContent(body.content), who);
    res.json(serialize(result));
  });
  // One treatment report per diagnostic draft. Reads reuse draft read scope; writes reuse the draft write permission
  // and student-author role; closing needs its own permission and the in-context teacher role.
  router.post('/:id/treatment-report', async (req, res) => {
    const who = await actor(req, true); const body = object(req.body, 'body'); keys(body, ['content']);
    const result = await repository.createTreatmentReport(decimal(req.params.id, 'draft id'), validateTreatmentContent(body.content ?? {}), who);
    res.status(201).json(serializeReport(result));
  });
  router.get('/:id/treatment-report', async (req, res) => {
    res.json(serializeReport(await repository.getTreatmentReport(decimal(req.params.id, 'draft id'), await actor(req, false))));
  });
  router.patch('/:id/treatment-report', async (req, res) => {
    const who = await actor(req, true); const body = object(req.body, 'body'); keys(body, ['expected_version', 'content']);
    const result = await repository.editTreatmentReport(decimal(req.params.id, 'draft id'), decimal(body.expected_version, 'expected_version'),
      validateTreatmentContent(body.content), who);
    res.json(serializeReport(result));
  });
  router.post('/:id/treatment-report/close', async (req, res) => {
    await new PermissionGuard('endodontics-treatment-reports:close').authorize(req);
    const id = await defaultGetActor(req);
    if (!isCanonicalUuid(id)) throw new UnauthorizedError('A verified UUID actor is required');
    if ((req as AuthenticatedRequest).auth!.role !== 'teacher') throw new ForbiddenError('teacher instructor role required');
    const body = object(req.body, 'body'); keys(body, ['expected_version', 'expected_draft_version']);
    const result = await repository.closeTreatmentReport(decimal(req.params.id, 'draft id'), decimal(body.expected_version, 'expected_version'),
      decimal(body.expected_draft_version, 'expected_draft_version'), { id, role: 'teacher' });
    res.json(serializeReport(result));
  });
  return router;
}
