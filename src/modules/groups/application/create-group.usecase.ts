import { BadRequestError } from '../../shared/domain/errors.js';
import { Group } from '../domain/group.entity.js';
import type { GroupRepositoryPort } from './group.ports.js';

const MAX_POSTGRES_INTEGER = 2147483647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateGroupInput {
  academic_year?: unknown;
  curriculum_semester?: unknown;
  name?: unknown;
  career_id?: unknown;
  createdBy?: string | null;
}

export class CreateGroup {
  private readonly repository: GroupRepositoryPort;

  constructor({ repository }: { repository: GroupRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: CreateGroupInput): Promise<Group> {
    const academicYear = validatePositiveInteger(input.academic_year, 'academic_year');
    const curriculumSemester = validatePositiveInteger(input.curriculum_semester, 'curriculum_semester');
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new BadRequestError('name must be a nonblank string');
    }
    const careerId = validateCareerId(input.career_id);

    return this.repository.create(Group.create({
      academicYear,
      curriculumSemester,
      name: input.name.trim(),
      careerId,
      createdBy: input.createdBy ?? null,
    }));
  }
}

export function validateCareerId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestError('career_id must be a UUID');
  }
  return value;
}

function validatePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_POSTGRES_INTEGER) {
    throw new BadRequestError(`${field} must be a positive 32-bit integer`);
  }
  return value;
}
