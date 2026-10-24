import { BadRequestError, ConflictError } from '../../shared/domain/errors.js';

export interface Assignment {
  id: string;
  patient_id: string;
  student_habilitation_id: string;
  subject_id: string;
  academic_group_id: string;
  assigned_by: string;
  assigned_at: Date | string;
  ended_by: string | null;
  ended_at: Date | string | null;
  end_reason: string | null;
  nombres?: string;
  apellidos?: string;
  documento?: string;
}

export interface AssignmentInput {
  patientId: string;
  periodId: string;
  subjectId: string;
  groupId: string;
  actorId: string;
}

/** Call only after contextual authorization, to avoid disclosing ended state. */
export function requireActiveAssignment(assignment: Pick<Assignment, 'ended_at'>): void {
  if (assignment.ended_at !== null) throw new ConflictError('assignment is already ended');
}

export function requireSameSubject(sourceSubjectId: string, destinationSubjectId: string): void {
  if (sourceSubjectId !== destinationSubjectId) throw new BadRequestError('reassignment must remain in the same subject');
}
