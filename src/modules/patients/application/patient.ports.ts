import type { Patient } from '../domain/patient.entity.js';

/**
 * Ports for the patients module. Use cases depend on these interfaces
 * only; infrastructure implementations (pg) are injected at wiring time,
 * keeping the dependency direction domain <- application <- infrastructure.
 */

export interface PatientRepositoryPort {
  findByDocumento(documento: string): Promise<Patient | null>;
  create(patient: Patient): Promise<Patient>;
}
