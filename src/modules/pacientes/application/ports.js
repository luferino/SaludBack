/**
 * Ports for the pacientes module. Use cases depend on these interfaces
 * only; infrastructure implementations (pg) are injected at wiring time,
 * keeping the dependency direction domain <- application <- infrastructure.
 */

export class PatientRepositoryPort {
  /**
   * @param {string} documento
   * @returns {Promise<import('../domain/patient.js').Patient|null>}
   */
  async findByDocumento(_documento) {
    throw new Error('PatientRepositoryPort#findByDocumento is not implemented');
  }

  /**
   * @param {import('../domain/patient.js').Patient} patient
   * @returns {Promise<import('../domain/patient.js').Patient>} the persisted patient
   */
  async create(_patient) {
    throw new Error('PatientRepositoryPort#create is not implemented');
  }
}
