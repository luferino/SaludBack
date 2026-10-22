import { BadRequestError } from '../../shared/domain/errors.js';
import type { StudentRepositoryPort, StudentListItem } from './student.ports.js';

export interface ListStudentsInput { limit?: unknown; offset?: unknown }
export interface ListStudentsResult { items: StudentListItem[]; limit: number; offset: number }

export class ListStudents {
  private readonly repository: StudentRepositoryPort;

  constructor({ repository }: { repository: StudentRepositoryPort }) { this.repository = repository; }

  async execute(input: ListStudentsInput = {}): Promise<ListStudentsResult> {
    const limit = parseBoundedInteger(input.limit, 50, 1, 100, 'limit');
    const offset = parseBoundedInteger(input.offset, 0, 0, 10000, 'offset');
    const items = await this.repository.list({ limit, offset });
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
