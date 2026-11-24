import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../shared/application/authenticated-request.js';
import { PermissionGuard } from '../shared/application/guard.js';
import { BadRequestError, ForbiddenError } from '../shared/domain/errors.js';
import type { AssignmentReportRepository } from './repository.js';

const guard = new PermissionGuard('assignment-reports:read');
const DAY_MS = 86_400_000;

function date(value: unknown, key: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000')) {
    const instant = new Date(value);
    if (Number.isFinite(+instant) && instant.toISOString().slice(0, 10) === value) return value;
  }
  throw new BadRequestError(`${key} must be a valid YYYY-MM-DD date`);
}

export function createAssignmentReportRouter(repository: AssignmentReportRepository, authenticate?: RequestHandler): Router {
  const router = Router();
  router.get('/', ...(authenticate ? [authenticate] : []), async (req, res) => {
    await guard.authorize(req);
    if ((req as AuthenticatedRequest).auth?.role !== 'admin') throw new ForbiddenError('Admin role required');
    const query = new URL(req.originalUrl, 'http://localhost').searchParams;
    for (const key of query.keys()) {
      if (key !== 'from' && key !== 'to') throw new BadRequestError('unknown query parameter');
      if (query.getAll(key).length !== 1) throw new BadRequestError(`query parameter must not be repeated: ${key}`);
    }
    const from = date(query.get('from'), 'from');
    const to = date(query.get('to'), 'to');
    if (from > to) throw new BadRequestError('from must be on or before to');
    if (Date.parse(to) - Date.parse(from) >= 366 * DAY_MS) throw new BadRequestError('date range must not exceed 366 days');

    const items = (await repository.countByContext(from, to)).map(
      ({ career, subject_id, academic_group_id, assignment_count }) => ({ career, subject_id, academic_group_id, assignment_count }),
    );
    const total = items.reduce((sum, item) => sum + item.assignment_count, 0);
    res.set('Cache-Control', 'no-store').json({ total, items });
  });
  return router;
}
