import { BadRequestError } from '../../shared/domain/errors.js';
import { SubjectGroup } from '../domain/subject-group.entity.js';
import type { SubjectGroupRepositoryPort } from './subject-group.ports.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateSubjectGroupInput {
  subject_id?: unknown;
  academic_group_id?: unknown;
  createdBy?: string | null;
}

export class CreateSubjectGroup {
  private readonly repository: SubjectGroupRepositoryPort;

  constructor({ repository }: { repository: SubjectGroupRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: CreateSubjectGroupInput): Promise<SubjectGroup> {
    const subjectId = validateUuid(input.subject_id, 'subject_id');
    const academicGroupId = validateUuid(input.academic_group_id, 'academic_group_id');
    return this.repository.create(new SubjectGroup({
      subjectId,
      academicGroupId,
      createdBy: input.createdBy ?? null,
    }));
  }
}

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validateUuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}
