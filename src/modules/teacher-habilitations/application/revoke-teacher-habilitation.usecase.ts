import { BadRequestError, UnauthorizedError } from '../../shared/domain/errors.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import { TeacherHabilitation } from '../domain/teacher-habilitation.entity.js';
import type { TeacherHabilitationRepositoryPort } from './teacher-habilitation.ports.js';

export interface RevokeTeacherHabilitationInput {
  id: unknown;
  revokedBy: unknown;
}

export class RevokeTeacherHabilitation {
  private readonly repository: TeacherHabilitationRepositoryPort;

  constructor({ repository }: { repository: TeacherHabilitationRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: RevokeTeacherHabilitationInput): Promise<TeacherHabilitation> {
    if (!isCanonicalUuid(input.revokedBy)) {
      throw new UnauthorizedError('A verified UUID actor is required');
    }
    if (!isCanonicalUuid(input.id)) throw new BadRequestError('id must be a UUID');
    return this.repository.revoke({ id: input.id, revokedBy: input.revokedBy });
  }
}
