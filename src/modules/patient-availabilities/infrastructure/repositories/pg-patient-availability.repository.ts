import type { Pool } from 'pg';
import type { UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { PatientAvailability, PatientAvailabilityPatient, EnablePatientAvailabilityInput } from '../../domain/patient-availability.js';
import type { PatientAvailabilityRepositoryPort } from '../../application/patient-availability.ports.js';

const COLUMNS = 'id::text AS id, patient_id, subject_id, academic_group_id, enabled_by, enabled_at, withdrawn_by, withdrawn_at';

export class PgPatientAvailabilityRepository implements PatientAvailabilityRepositoryPort {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  async enable(input: EnablePatientAvailabilityInput): Promise<PatientAvailability> {
    try {
      return await this.unitOfWork.withTransaction(async db => {
        const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [input.patientId]);
        if (!patient.rows.length) throw new NotFoundError('patient was not found');
        const context = await db.query<{ id: string }>(
          `SELECT subject_id AS id FROM subject_academic_groups WHERE subject_id = $1 AND academic_group_id = $2`, [input.subjectId, input.groupId]);
        if (!context.rows.length) throw new NotFoundError('subject or academic group was not found');
        const inserted = await db.query<PatientAvailability>(
          `INSERT INTO patient_context_availabilities (patient_id, subject_id, academic_group_id, enabled_by)
           VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
          [input.patientId, input.subjectId, input.groupId, input.actorId]);
        return inserted.rows[0];
      });
    } catch (error) {
      const dbError = error as { code?: string; constraint?: string };
      if (dbError.code === '23505' && dbError.constraint === 'patient_context_availabilities_one_active') throw new ConflictError('patient is already available in this context');
      throw error;
    }
  }

  async withdraw(id: string, actorId: string): Promise<PatientAvailability> {
    return this.unitOfWork.withTransaction(async db => {
      const located = await db.query<{ patient_id: string }>('SELECT patient_id FROM patient_context_availabilities WHERE id = $1', [id]);
      if (!located.rows.length) throw new NotFoundError('patient availability was not found');
      const patient = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [located.rows[0].patient_id]);
      if (!patient.rows.length) throw new NotFoundError('patient was not found');
      const updated = await db.query<PatientAvailability>(
        `UPDATE patient_context_availabilities SET withdrawn_by = COALESCE(withdrawn_by, $2),
           withdrawn_at = COALESCE(withdrawn_at, clock_timestamp()) WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, actorId]);
      if (!updated.rows.length) throw new NotFoundError('patient availability was not found');
      return updated.rows[0];
    });
  }

  async history(patientId: string, limit: number, offset: number): Promise<PatientAvailability[]> {
    const { rows } = await this.pool.query<PatientAvailability>(
      `SELECT ${COLUMNS} FROM patient_context_availabilities WHERE patient_id = $1 ORDER BY enabled_at DESC, id DESC LIMIT $2 OFFSET $3`, [patientId, limit, offset]);
    return rows;
  }

  async searchPatient(documento: string): Promise<PatientAvailabilityPatient[]> {
    const { rows } = await this.pool.query<PatientAvailabilityPatient>(
      'SELECT id AS patient_id, nombres, apellidos FROM patients WHERE documento = $1 ORDER BY id LIMIT 1', [documento]);
    return rows;
  }

  async listTeacher(actorId: string, subjectId: string, groupId: string, limit: number, offset: number, assignable: boolean): Promise<PatientAvailabilityPatient[]> {
    const { rows } = await this.pool.query<PatientAvailabilityPatient>(
      `SELECT p.id AS patient_id, p.nombres, p.apellidos
         FROM patient_context_availabilities a JOIN patients p ON p.id = a.patient_id
        WHERE a.subject_id = $2 AND a.academic_group_id = $3 AND a.withdrawn_at IS NULL
          AND EXISTS (SELECT 1 FROM teachers t JOIN teacher_academic_habilitations h ON h.teacher_id = t.id
                       WHERE t.user_id = $1 AND h.subject_id = $2 AND h.academic_group_id = $3 AND h.revoked_at IS NULL)
          AND ($6::boolean IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM patient_assignments pa
                       WHERE pa.patient_id = a.patient_id AND pa.subject_id = $2 AND pa.ended_at IS NULL))
        ORDER BY p.apellidos, p.nombres, p.id LIMIT $4 OFFSET $5`, [actorId, subjectId, groupId, limit, offset, assignable]);
    return rows;
  }
}
