import { BadRequestError, UnauthorizedError } from '../../shared/domain/errors.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import { TeacherHabilitation } from '../domain/teacher-habilitation.entity.js';
import type { TeacherHabilitationRepositoryPort } from './teacher-habilitation.ports.js';

export interface ActivateTeacherHabilitationInput {
  teacher_id?: unknown;
  subject_id?: unknown;
  academic_group_id?: unknown;
  activatedBy: unknown;
}

export class ActivateTeacherHabilitation {
  private readonly repository: TeacherHabilitationRepositoryPort;

  constructor({ repository }: { repository: TeacherHabilitationRepositoryPort }) {
    this.repository = repository;
  }

  async execute(input: ActivateTeacherHabilitationInput): Promise<TeacherHabilitation> {
    if (!isCanonicalUuid(input.activatedBy)) {
      throw new UnauthorizedError('A verified UUID actor is required');
    }
    const teacherId = validateUuid(input.teacher_id, 'teacher_id');
    const subjectId = validateUuid(input.subject_id, 'subject_id');
    const academicGroupId = validateUuid(input.academic_group_id, 'academic_group_id');
    return this.repository.activate({
      teacherId,
      subjectId,
      academicGroupId,
      activatedBy: input.activatedBy,
    });
  }
}

function validateUuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}
