import type { Patient } from '../domain/patient.entity.js';
import type { MaritalStatus, MedicalInsurance, PersonalDataPatch } from '../domain/personal-data.js';

/**
 * Ports for the patients module. Use cases depend on these interfaces
 * only; infrastructure implementations (pg) are injected at wiring time,
 * keeping the dependency direction domain <- application <- infrastructure.
 */

export interface PatientListInput {
  q?: string;
  limit: number;
  offset: number;
}

export interface PatientListingRepositoryPort {
  list(input: PatientListInput): Promise<Patient[]>;
}

export interface PatientRepositoryPort {
  findByDocumento(documento: string): Promise<Patient | null>;
  create(patient: Patient): Promise<Patient>;
}

/**
 * Updates only the personal-data fields present in `patch` and sets the audit columns. Resolves to null
 * when no patient has the id.
 */
export interface PatientPersonalDataRepositoryPort {
  updatePersonalData(id: string, patch: PersonalDataPatch, actorId: string): Promise<Patient | null>;
}

/** Verified caller for the student/teacher personal-data endpoints: the token subject and the selected role. */
export interface PersonalDataActor {
  id: string;
  role: string;
}

/** Identity header and the two personal-data fields, as the student and teacher endpoints expose them. */
export interface PersonalDataRecord {
  id: string;
  documento: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  sexo: string;
  direccion: string;
  maritalStatus: MaritalStatus | null;
  medicalInsurance: MedicalInsurance | null;
}

/**
 * Access-checked reads and writes for the student and teacher endpoints. Each method resolves to null when the
 * patient is unknown or the selected role has no access, so the two cases cannot be told apart.
 */
export interface PatientPersonalDataAccessRepositoryPort {
  readPersonalData(id: string, actor: PersonalDataActor): Promise<PersonalDataRecord | null>;
  updateAsStudent(id: string, patch: PersonalDataPatch, actor: PersonalDataActor): Promise<PersonalDataRecord | null>;
}
