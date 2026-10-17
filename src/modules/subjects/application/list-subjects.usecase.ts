import { BadRequestError } from '../../shared/domain/errors.js';
import type { Subject } from '../domain/subject.entity.js';
import type { SubjectRepositoryPort } from './subject.ports.js';

export interface ListSubjectsInput {
  limit?: unknown;
  offset?: unknown;
}

export interface ListSubjectsResult {
  items: Subject[];
  limit: number;
  offset: number;
}

export class ListSubjects {
  private readonly repository: SubjectRepositoryPort;

  constructor({ repository }: { repository: SubjectRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: ListSubjectsInput = {}): Promise<ListSubjectsResult> {
    const limit = parseBoundedInteger(input.limit, 50, 1, 100, 'limit');
    const offset = parseBoundedInteger(input.offset, 0, 0, 10000, 'offset');
    const items = await this.repository.list({ limit, offset });
    return { items, limit, offset };
  }
}

function parseBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}
