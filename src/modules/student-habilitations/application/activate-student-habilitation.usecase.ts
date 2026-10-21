import { BadRequestError, UnauthorizedError } from '../../shared/domain/errors.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import type { StudentHabilitationRepositoryPort } from './student-habilitation.ports.js';

export class ActivateStudentHabilitation {
  constructor(private readonly repository: StudentHabilitationRepositoryPort) {}

  async execute(input: { student_id?: unknown; subject_id?: unknown; academic_group_id?: unknown; activatedBy: unknown }) {
    if (!isCanonicalUuid(input.activatedBy)) throw new UnauthorizedError('A verified UUID actor is required');
    return this.repository.activate({
      studentId: uuid(input.student_id, 'student_id'),
      subjectId: uuid(input.subject_id, 'subject_id'),
      academicGroupId: uuid(input.academic_group_id, 'academic_group_id'),
      activatedBy: input.activatedBy,
    });
  }
}

function uuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}
