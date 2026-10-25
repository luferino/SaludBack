import type { PatientAvailability, EnablePatientAvailabilityInput, PatientAvailabilityPatient } from '../domain/patient-availability.js';

export interface PatientAvailabilityRepositoryPort {
  enable(input: EnablePatientAvailabilityInput): Promise<PatientAvailability>;
  withdraw(id: string, actorId: string): Promise<PatientAvailability>;
  history(patientId: string, limit: number, offset: number): Promise<PatientAvailability[]>;
  searchPatient(documento: string): Promise<PatientAvailabilityPatient[]>;
  listTeacher(actorId: string, subjectId: string, groupId: string, limit: number, offset: number): Promise<PatientAvailabilityPatient[]>;
}
