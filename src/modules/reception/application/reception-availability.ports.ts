import type { Queryable } from '../../shared/application/unit-of-work.js';
import type { PatientAvailability } from '../../patient-availabilities/domain/patient-availability.js';

export interface ReceptionAvailabilityRepository {
  withActiveCareerScope<T>(userId: string, career: string, work: (db: Queryable) => Promise<T>): Promise<T>;
  contextChoices(db: Queryable, career: string, limit: number, offset: number): Promise<Array<{ career: string; subject_id: string; academic_group_id: string; subject_name: string; academic_group_name: string }>>;
  enable(db: Queryable, career: string, input: { patientId: string; subjectId: string; groupId: string; actorId: string }): Promise<PatientAvailability>;
  withdraw(db: Queryable, career: string, id: string, actorId: string): Promise<PatientAvailability>;
  history(db: Queryable, career: string, patientId: string, limit: number, offset: number): Promise<PatientAvailability[]>;
  search(db: Queryable, career: string, documento: string, limit: number, offset: number): Promise<Array<{ patient_id: string; nombres: string; apellidos: string }>>;
}
