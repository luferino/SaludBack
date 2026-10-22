import { BadRequestError } from '../../shared/domain/errors.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import type { TeacherHabilitationRepositoryPort, HabilitationListFilter, HabilitationPeriodListing } from './teacher-habilitation.ports.js';

export interface ListTeacherHabilitationsInput { teacherId?: unknown; subjectId?: unknown; academicGroupId?: unknown; status?: unknown; limit?: unknown; offset?: unknown; }
export interface HabilitationListResult<T> { items: T[]; limit: number; offset: number; }

export class ListTeacherHabilitations {
  constructor(private readonly repository: TeacherHabilitationRepositoryPort) {}

  async execute(input: ListTeacherHabilitationsInput = {}): Promise<HabilitationListResult<HabilitationPeriodListing>> {
    const filters = validateFilters(input);
    const limit = parseBoundedInteger(input.limit, 50, 1, 100, 'limit');
    const offset = parseBoundedInteger(input.offset, 0, 0, 10000, 'offset');
    const items = await this.repository.list({ ...filters, limit, offset });
    return { items, limit, offset };
  }
}

export function validateFilters(input: ListTeacherHabilitationsInput): HabilitationListFilter {
  const result: HabilitationListFilter = {};
  for (const [key, field] of [['teacherId', 'teacher_id'], ['subjectId', 'subject_id'], ['academicGroupId', 'academic_group_id']] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
    result[key] = value.toLowerCase();
  }
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'revoked') throw new BadRequestError('status must be active or revoked');
    result.status = input.status;
  }
  return result;
}

export function parseBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}
