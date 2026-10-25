import type { PatientAssignmentOptionsRepositoryPort } from './patient-assignment-options.ports.js';

export class PatientAssignmentOptionsService {
  constructor(private readonly repository: PatientAssignmentOptionsRepositoryPort) {}

  listContexts(actorId: string, limit: number, offset: number) {
    return this.repository.listContexts(actorId, limit, offset);
  }

  listStudents(actorId: string, subjectId: string, academicGroupId: string, limit: number, offset: number) {
    return this.repository.listStudents(actorId, subjectId, academicGroupId, limit, offset);
  }
}
