import { BadRequestError } from '../../shared/domain/errors.js';
import type { TeacherRepositoryPort, TeacherListItem } from './teacher.ports.js';

export interface ListTeachersInput { limit?: unknown; offset?: unknown; q?: unknown }
export interface ListTeachersResult { items: TeacherListItem[]; limit: number; offset: number }

export class ListTeachers {
  private readonly repository: TeacherRepositoryPort;

  constructor({ repository }: { repository: TeacherRepositoryPort }) { this.repository = repository; }

  async execute(input: ListTeachersInput = {}): Promise<ListTeachersResult> {
    const limit = parseBoundedInteger(input.limit, 50, 1, 100, 'limit');
    const offset = parseBoundedInteger(input.offset, 0, 0, 10000, 'offset');
    if (input.q !== undefined && (typeof input.q !== 'string' || input.q.trim().length > 100)) {
      throw new BadRequestError('q must be a string of at most 100 characters');
    }
    const q = typeof input.q === 'string' ? input.q.trim() : '';
    const items = await this.repository.list({ limit, offset, ...(q ? { q } : {}) });
    return { items, limit, offset };
  }
}

function parseBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}
