import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import type { ReceptionAvailabilityRepository } from '../../application/reception-availability.ports.js';
import type { PatientAvailability } from '../../../patient-availabilities/domain/patient-availability.js';

const CAREERS = new Set(['kinesiology', 'odontology']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, name: string): string { if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestError(`${name} must be a UUID`); return value; }
function career(value: unknown): string { if (typeof value !== 'string' || !CAREERS.has(value)) throw new BadRequestError('career must be kinesiology or odontology'); return value; }
function pagination(query: Request['query']) {
  const parse = (v: unknown, fallback: number, name: string) => {
    if (v === undefined) return fallback;
    if (Array.isArray(v) || typeof v !== 'string' || !/^\d+$/.test(v)) throw new BadRequestError(`${name} must be an integer`);
    const n = Number(v); if (!Number.isSafeInteger(n) || n < 0) throw new BadRequestError(`${name} must be an integer`); return n;
  };
  const limit = parse(query.limit, 50, 'limit'), offset = parse(query.offset, 0, 'offset');
  if (limit < 1 || limit > 100) throw new BadRequestError('limit must be between 1 and 100');
  if (offset > 10000) throw new BadRequestError('offset must be between 0 and 10000');
  return { limit, offset };
}
function activity(row: PatientAvailability) { return { id: row.id, subject_id: row.subject_id, academic_group_id: row.academic_group_id,
  enabled_at: new Date(row.enabled_at).toISOString(), withdrawn_at: row.withdrawn_at ? new Date(row.withdrawn_at).toISOString() : null }; }

export function createReceptionAvailabilityRouter({ repository, guard = new PermissionGuard('reception:availability:manage'), getActor = defaultGetActor, authenticate }: {
  repository: ReceptionAvailabilityRepository; guard?: Guard; getActor?: (req: Request) => Promise<string | null>; authenticate?: RequestHandler;
}): Router {
  const router = Router(), auth = authenticate ? [authenticate] : [];
  const inScope = <T>(req: Request, userId: string, selected: string, work: (db: import('../../../shared/application/unit-of-work.js').Queryable) => Promise<T>) =>
    repository.withActiveCareerScope(userId, selected, work, (req as AuthenticatedRequest).auth?.roleGrantId);
  const actor = async (req: Request) => {
    await guard.authorize(req);
    if ((req as AuthenticatedRequest).auth?.role !== 'reception') throw new ForbiddenError('Reception role required');
    const id = await getActor(req); if (!id || !UUID.test(id)) throw new UnauthorizedError('verified Reception actor is required'); return id;
  };
  router.get('/contexts', ...auth, async (req: Request, res: Response) => {
    const user = await actor(req), selected = career(req.query.career), page = pagination(req.query);
    const items = await inScope(req, user, selected, db => repository.contextChoices(db, selected, page.limit, page.offset));
    res.setHeader('Cache-Control', 'no-store'); res.status(200).json({ items, ...page });
  });
  router.post('/', ...auth, async (req: Request, res: Response) => {
    const user = await actor(req), selected = career(req.body?.career);
    const input = { patientId: uuid(req.body?.patient_id, 'patient_id'), subjectId: uuid(req.body?.subject_id, 'subject_id'), groupId: uuid(req.body?.academic_group_id, 'academic_group_id'), actorId: user };
    const result = await inScope(req, user, selected, db => repository.enable(db, selected, input));
    res.status(201).json(activity(result));
  });
  router.get('/history', ...auth, async (req: Request, res: Response) => {
    const user = await actor(req), selected = career(req.query.career), patientId = uuid(req.query.patient_id, 'patient_id'), page = pagination(req.query);
    const rows = await inScope(req, user, selected, db => repository.history(db, selected, patientId, page.limit, page.offset));
    res.setHeader('Cache-Control', 'no-store'); res.status(200).json({ items: rows.map(activity), ...page });
  });
  router.get('/search', ...auth, async (req: Request, res: Response) => {
    const user = await actor(req), selected = career(req.query.career), documento = req.query.documento;
    if (typeof documento !== 'string' || !/^\d{4,8}$/.test(documento.trim())) throw new BadRequestError('documento must be 4-8 digits');
    const page = pagination(req.query);
    const items = await inScope(req, user, selected, db => repository.search(db, selected, documento.trim(), page.limit, page.offset));
    res.setHeader('Cache-Control', 'no-store'); res.status(200).json({ items, ...page });
  });
  router.post('/:id/withdraw', ...auth, async (req: Request, res: Response) => {
    const user = await actor(req), selected = career(req.body?.career), id = uuid(req.params.id, 'id');
    const result = await inScope(req, user, selected, db => repository.withdraw(db, selected, id, user));
    res.status(200).json(activity(result));
  });
  return router;
}
