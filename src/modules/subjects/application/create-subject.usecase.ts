import { BadRequestError } from '../../shared/domain/errors.js';
import { Subject } from '../domain/subject.entity.js';
import type { SubjectRepositoryPort } from './subject.ports.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateSubjectInput {
  name?: unknown;
  career_id?: unknown;
  createdBy?: string | null;
}

export class CreateSubject {
  private readonly repository: SubjectRepositoryPort;

  constructor({ repository }: { repository: SubjectRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: CreateSubjectInput): Promise<Subject> {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new BadRequestError('name must be a nonblank string');
    }
    const careerId = validateCareerId(input.career_id);
    return this.repository.create(Subject.create({
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
