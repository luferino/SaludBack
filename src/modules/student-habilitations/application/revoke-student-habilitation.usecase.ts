import { BadRequestError, UnauthorizedError } from '../../shared/domain/errors.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import type { StudentHabilitationRepositoryPort } from './student-habilitation.ports.js';

export class RevokeStudentHabilitation {
  constructor(private readonly repository: StudentHabilitationRepositoryPort) {}

  async execute(input: { id: unknown; revokedBy: unknown }) {
    if (!isCanonicalUuid(input.revokedBy)) throw new UnauthorizedError('A verified UUID actor is required');
    if (!isCanonicalUuid(input.id)) throw new BadRequestError('id must be a UUID');
    return this.repository.revoke({ id: input.id, revokedBy: input.revokedBy });
  }
}
