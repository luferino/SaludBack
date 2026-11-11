import type { Queryable } from '../../shared/application/unit-of-work.js';
import type { Patient } from '../../patients/domain/patient.entity.js';

export interface ReceptionPatientRepository {
  withActiveCareerScope<T>(userId: string, career: string, work: (client: Queryable) => Promise<T>, roleGrantId?: string): Promise<T>;
  matchByDocumento(db: Queryable, documento: string): Promise<{ id: string } | null>;
  findPatientByDocumento(db: Queryable, documento: string): Promise<Patient | null>;
  enrollExisting(db: Queryable, id: string, career: string): Promise<void>;
  createAndEnroll(db: Queryable, patient: Patient, career: string): Promise<Patient>;
  list(db: Queryable, career: string, limit: number, offset: number): Promise<Patient[]>;
  findEnrolled(db: Queryable, id: string, career: string): Promise<Patient | null>;
  updateContact(db: Queryable, id: string, career: string, input: { email: string; celular: string; direccion: string }, actorId: string): Promise<Patient | null>;
}
