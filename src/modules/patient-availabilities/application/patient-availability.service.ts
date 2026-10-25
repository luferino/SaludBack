import type { PatientAvailabilityRepositoryPort } from './patient-availability.ports.js';
import type { EnablePatientAvailabilityInput } from '../domain/patient-availability.js';

export class PatientAvailabilityService {
  constructor(private readonly repository: PatientAvailabilityRepositoryPort) {}
  enable(input: EnablePatientAvailabilityInput) { return this.repository.enable(input); }
  withdraw(id: string, actorId: string) { return this.repository.withdraw(id, actorId); }
  history(patientId: string, limit: number, offset: number) { return this.repository.history(patientId, limit, offset); }
  searchPatient(documento: string) { return this.repository.searchPatient(documento); }
  listTeacher(actorId: string, subjectId: string, groupId: string, limit: number, offset: number) {
    return this.repository.listTeacher(actorId, subjectId, groupId, limit, offset);
  }
}
