import { BadRequestError, UnauthorizedError } from '../../shared/domain/errors.js';
import { isCanonicalUuid } from '../../subject-groups/application/create-subject-group.usecase.js';
import type { StudentHabilitationListInput, StudentHabilitationRepositoryPort } from './student-habilitation.ports.js';

export class ListStudentHabilitations {
  constructor(private readonly repository: StudentHabilitationRepositoryPort) {}

  async execute(input: { studentId?: unknown; subjectId?: unknown; academicGroupId?: unknown; status?: unknown; limit?: unknown; offset?: unknown; actorId: string | null; isAdmin: boolean }) {
    const studentId = uuidFilter(input.studentId, 'student_id');
    const subjectId = uuidFilter(input.subjectId, 'subject_id');
    const academicGroupId = uuidFilter(input.academicGroupId, 'academic_group_id');
    if (input.status !== undefined && input.status !== 'active' && input.status !== 'revoked') {
      throw new BadRequestError('status must be active or revoked');
    }
    const status = input.status as StudentHabilitationListInput['status'];
    if (!input.isAdmin && !isCanonicalUuid(input.actorId)) throw new UnauthorizedError('A verified UUID actor is required');
    const limit = pagination(input.limit, 50, 1, 100, 'limit');
    const offset = pagination(input.offset, 0, 0, 10000, 'offset');
    const items = await this.repository.list({ studentId, subjectId, academicGroupId, status, limit, offset, actorId: input.actorId, isAdmin: input.isAdmin });
    return { items, limit, offset };
  }
}

function uuidFilter(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value.toLowerCase();
}

function pagination(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}
