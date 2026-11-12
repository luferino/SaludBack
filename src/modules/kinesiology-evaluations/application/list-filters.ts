import { BadRequestError } from '../../shared/domain/errors.js';

export type KinesiologyStatus = 'draft' | 'submitted' | 'validated';
export interface KinesiologyListFilters {
  status?: KinesiologyStatus;
  dateFrom?: string;
  dateTo?: string;
  evaluationId?: string;
}

const MAX_BIGINT = 9223372036854775807n;

function scalar(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new BadRequestError(`${field} must be a single string`);
  return value;
}

function date(value: unknown, field: string): string {
  const result = scalar(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result.startsWith('0000-')) throw new BadRequestError(`${field} must be a real YYYY-MM-DD date`);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new BadRequestError(`${field} must be a real YYYY-MM-DD date`);
  }
  return result;
}

export function parseKinesiologyListFilters(query: Record<string, unknown>): KinesiologyListFilters {
  for (const field of ['status', 'date_from', 'date_to', 'evaluation_id']) {
    if (Object.keys(query).some(key => key.startsWith(`${field}[`))) {
      throw new BadRequestError(`${field} must be a single string`);
    }
  }
  const statusValue = query.status === undefined ? undefined : scalar(query.status, 'status');
  if (statusValue !== undefined && !['draft', 'submitted', 'validated'].includes(statusValue)) {
    throw new BadRequestError('status must be draft, submitted, or validated');
  }
  const dateFrom = query.date_from === undefined ? undefined : date(query.date_from, 'date_from');
  const dateTo = query.date_to === undefined ? undefined : date(query.date_to, 'date_to');
  if (dateFrom && dateTo && dateFrom > dateTo) throw new BadRequestError('date_from must not be after date_to');
  return { status: statusValue as KinesiologyStatus | undefined, dateFrom, dateTo };
}

export function parseKinesiologyEvaluationId(value: unknown): string {
  const id = scalar(value, 'evaluation_id');
  if (!/^[1-9]\d*$/.test(id) || BigInt(id) > MAX_BIGINT) {
    throw new BadRequestError('evaluation_id must be a positive BIGINT decimal string');
  }
  return id;
}
