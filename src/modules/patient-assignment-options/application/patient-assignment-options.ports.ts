import type { PatientAssignmentContextOption, PatientAssignmentStudentOption } from '../domain/patient-assignment-option.js';

export interface PatientAssignmentOptionsRepositoryPort {
  listContexts(actorId: string, limit: number, offset: number): Promise<PatientAssignmentContextOption[]>;
  listStudents(actorId: string, subjectId: string, academicGroupId: string, limit: number, offset: number): Promise<PatientAssignmentStudentOption[]>;
}
