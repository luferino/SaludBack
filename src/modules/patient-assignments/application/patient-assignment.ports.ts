import type { Assignment, AssignmentInput } from '../domain/patient-assignment.js';

export interface AssignmentListFilters {
  patient_id?: string;
  student_id?: string;
  subject_id?: string;
  academic_group_id?: string;
}

/** Each mutation is atomic and checks live source/destination authorization before
 * state disclosure. Adapters retain ordered context/period/patient/assignment locks.
 */
export interface PatientAssignmentRepositoryPort {
  create(input: AssignmentInput): Promise<Assignment>;
  reassign(id: string, input: Omit<AssignmentInput, 'patientId'>): Promise<Assignment>;
  end(id: string, actorId: string, reason: string): Promise<Assignment>;
  listTeacher(actorId: string, limit: number, offset: number, filters?: AssignmentListFilters): Promise<Assignment[]>;
  listOwn(actorId: string, limit: number, offset: number, filters?: AssignmentListFilters): Promise<Assignment[]>;
}
