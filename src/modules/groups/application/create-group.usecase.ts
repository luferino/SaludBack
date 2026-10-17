import { BadRequestError } from '../../shared/domain/errors.js';
import { Group } from '../domain/group.entity.js';
import type { GroupRepositoryPort } from './group.ports.js';

const MAX_POSTGRES_INTEGER = 2147483647;

export interface CreateGroupInput {
  academic_year?: unknown;
  curriculum_semester?: unknown;
  name?: unknown;
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

    return this.repository.create(Group.create({
      academicYear,
      curriculumSemester,
      name: input.name.trim(),
      createdBy: input.createdBy ?? null,
    }));
  }
}

function validatePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_POSTGRES_INTEGER) {
    throw new BadRequestError(`${field} must be a positive 32-bit integer`);
  }
  return value;
}
