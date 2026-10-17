import { BadRequestError } from '../../shared/domain/errors.js';
import { isCanonicalUuid } from './create-subject-group.usecase.js';
import type { SubjectGroup } from '../domain/subject-group.entity.js';
import type { SubjectGroupRepositoryPort } from './subject-group.ports.js';

export interface ListSubjectGroupsInput {
  subject_id?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export interface ListSubjectGroupsResult {
  items: SubjectGroup[];
  limit: number;
  offset: number;
}

export class ListSubjectGroups {
  private readonly repository: SubjectGroupRepositoryPort;

  constructor({ repository }: { repository: SubjectGroupRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: ListSubjectGroupsInput = {}): Promise<ListSubjectGroupsResult> {
    const subjectId = input.subject_id === undefined ? undefined : parseSubjectId(input.subject_id);
    const limit = parseBoundedInteger(input.limit, 50, 1, 100, 'limit');
    const offset = parseBoundedInteger(input.offset, 0, 0, 10000, 'offset');
    const items = await this.repository.list({ subjectId, limit, offset });
    return { items, limit, offset };
  }
}

function parseSubjectId(value: unknown): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError('subject_id must be a UUID');
  return value;
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
