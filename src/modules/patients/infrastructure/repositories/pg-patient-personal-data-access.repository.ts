import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../../../shared/application/unit-of-work.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import type { PatientPersonalDataAccessRepositoryPort, PersonalDataActor, PersonalDataRecord } from '../../application/patient.ports.js';
import type { MaritalStatus, MedicalInsurance, PersonalDataPatch } from '../../domain/personal-data.js';

interface PersonalDataRow {
  id: string;
  documento: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string;
  sexo: string;
  direccion: string;
  marital_status: MaritalStatus | null;
  medical_insurance: MedicalInsurance | null;
}

const COLUMNS = `id, documento, nombres, apellidos, to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  sexo, direccion, marital_status, medical_insurance`;

// Access to the patient for the selected role only (S4, S6). A student needs an active habilitation with an
// active assignment to this patient on that same habilitation; a teacher needs an active teacher habilitation
// on the subject and group of the student habilitation behind an active assignment of this patient.
const ACCESS = `(($3 = 'estudiante' AND EXISTS (
  SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
  JOIN patient_assignments a ON a.student_habilitation_id = sp.id AND a.subject_id = sp.subject_id
  WHERE s.user_id = $2 AND sp.revoked_at IS NULL AND a.patient_id = p.id AND a.ended_at IS NULL
)) OR ($3 = 'teacher' AND EXISTS (
  SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
  JOIN student_academic_habilitations sp ON th.subject_id = sp.subject_id AND th.academic_group_id = sp.academic_group_id
  JOIN patient_assignments a ON a.student_habilitation_id = sp.id AND a.subject_id = sp.subject_id
  WHERE t.user_id = $2 AND th.revoked_at IS NULL AND sp.revoked_at IS NULL
    AND a.patient_id = p.id AND a.ended_at IS NULL
)))`;

/**
 * PostgreSQL access-checked personal data for the student and teacher endpoints. Reads are one statement. The
 * student write runs in one transaction that locks, in order, the student's habilitation, the patient and the
 * assignment, the same order the hygiene draft writes use, so a revocation or assignment end waits for the commit.
 */
export class PgPatientPersonalDataAccessRepository implements PatientPersonalDataAccessRepositoryPort {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  async readPersonalData(id: string, actor: PersonalDataActor): Promise<PersonalDataRecord | null> {
    const { rows } = await this.pool.query<PersonalDataRow>(
      `SELECT ${COLUMNS} FROM patients p WHERE p.id = $1 AND ${ACCESS}`,
      [id, actor.id, actor.role],
    );
    return rows.length === 0 ? null : toRecord(rows[0]);
  }

  async updateAsStudent(id: string, patch: PersonalDataPatch, actor: PersonalDataActor): Promise<PersonalDataRecord | null> {
    if (actor.role !== 'estudiante') throw new ForbiddenError('student role required');
    return this.unitOfWork.withTransaction(async db => {
      if (!await this.lockAuthorizedAssignment(db, id, actor.id)) return null;
      // Same SET as PgPatientRepository.updatePersonalData: an omitted field keeps its value, null clears it.
      const { rows } = await db.query<PersonalDataRow>(
        `UPDATE patients SET
           marital_status = CASE WHEN $2::boolean THEN $3::text ELSE marital_status END,
           medical_insurance = CASE WHEN $4::boolean THEN $5::text ELSE medical_insurance END,
           updated_by = $6,
           updated_at = clock_timestamp()
         WHERE id = $1
         RETURNING ${COLUMNS}`,
        [
          id,
          patch.maritalStatus !== undefined,
          patch.maritalStatus ?? null,
          patch.medicalInsurance !== undefined,
          patch.medicalInsurance ?? null,
          actor.id,
        ],
      );
      return rows.length === 0 ? null : toRecord(rows[0]);
    });
  }

  // Locks the student period, patient and assignment so the access check holds until the transaction commits.
  // Any missing link resolves to false, which the caller reports as not found.
  private async lockAuthorizedAssignment(db: Queryable, patientId: string, actorId: string): Promise<boolean> {
    const students = await db.query<{ id: string }>('SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [actorId]);
    if (!students.rows.length) return false;
    const periods = await db.query<{ id: string }>(
      `SELECT h.id FROM student_academic_habilitations h
       WHERE h.student_id = $1 AND h.revoked_at IS NULL ORDER BY h.id FOR UPDATE OF h`,
      [students.rows[0].id],
    );
    if (!periods.rows.length) return false;
    const patients = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [patientId]);
    if (!patients.rows.length) return false;
    const assignments = await db.query<{ id: string }>(
      `SELECT a.id FROM patient_assignments a
       WHERE a.patient_id = $1 AND a.student_habilitation_id = ANY($2::uuid[]) AND a.ended_at IS NULL
       ORDER BY a.id FOR UPDATE OF a`,
      [patientId, periods.rows.map(row => row.id)],
    );
    return assignments.rows.length > 0;
  }
}

function toRecord(row: PersonalDataRow): PersonalDataRecord {
  return {
    id: row.id,
    documento: row.documento,
    nombres: row.nombres,
    apellidos: row.apellidos,
    fechaNacimiento: row.fecha_nacimiento,
    sexo: row.sexo,
    direccion: row.direccion,
    maritalStatus: row.marital_status,
    medicalInsurance: row.medical_insurance,
  };
}
