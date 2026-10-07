import { BadRequestError } from '../../shared/domain/errors.js';
import { Subject } from '../domain/subject.entity.js';
import type { SubjectRepositoryPort } from './subject.ports.js';

export class CreateSubject {
  private readonly repository: SubjectRepositoryPort;

  constructor({ repository }: { repository: SubjectRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: { name?: unknown; createdBy?: string | null }): Promise<Subject> {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new BadRequestError('name must be a nonblank string');
    }
    return this.repository.create(Subject.create({
      name: input.name.trim(),
      createdBy: input.createdBy ?? null,
    }));
  }
}
