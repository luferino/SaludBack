import type { Pool } from 'pg';
import { Patient } from '../../../patients/domain/patient.entity.js';
import type { ReceptionPatientRepository } from '../../application/reception-patients.ports.js';
import type { Queryable } from '../../../shared/application/unit-of-work.js';
import { PgReceptionAccessRepository } from './pg-reception-access.repository.js';

interface PatientRow {
  id: string; documento: string; nombres: string; apellidos: string; fecha_nacimiento: Date | string;
  email: string; celular: string; sexo: string; direccion: string; created_by: string | null;
  created_at: Date | string; updated_by: string | null; updated_at: Date | string | null;
}
const COLUMNS = 'p.id, p.documento, p.nombres, p.apellidos, p.fecha_nacimiento, p.email, p.celular, p.sexo, p.direccion, p.created_by, p.created_at, p.updated_by, p.updated_at';

export class PgReceptionPatientRepository implements ReceptionPatientRepository {
  private readonly access: PgReceptionAccessRepository;
  constructor(private readonly pool: Pool) { this.access = new PgReceptionAccessRepository(pool); }
  withActiveCareerScope<T>(userId: string, career: string, work: (client: Queryable) => Promise<T>, roleGrantId?: string): Promise<T> {
    return this.access.withActiveCareerScope(userId, career, work, roleGrantId);
  }
  async matchByDocumento(db: Queryable, documento: string): Promise<{ id: string } | null> {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM patients WHERE documento = $1', [documento]);
    return rows[0] ?? null;
  }
  async findPatientByDocumento(db: Queryable, documento: string): Promise<Patient | null> {
    const { rows } = await db.query<PatientRow>(`SELECT ${COLUMNS} FROM patients p WHERE p.documento = $1`, [documento]);
    return rows.length ? mapPatient(rows[0]) : null;
  }
  async enrollExisting(db: Queryable, id: string, career: string): Promise<void> {
    await db.query(`INSERT INTO reception_patient_enrollments (patient_id, career_id)
      SELECT $1, c.id FROM careers c WHERE c.code = $2 ON CONFLICT (patient_id, career_id) DO NOTHING`, [id, career]);
  }
  async createAndEnroll(db: Queryable, patient: Patient, career: string): Promise<Patient> {
    const { rows } = await db.query<PatientRow>(`INSERT INTO patients (documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion,created_by,created_at,updated_by,updated_at`,
    [patient.documento, patient.nombres, patient.apellidos, patient.fechaNacimiento, patient.email, patient.celular, patient.sexo, patient.direccion, patient.createdBy]);
    await this.enrollExisting(db, rows[0].id, career);
    return mapPatient(rows[0]);
  }
  async list(db: Queryable, career: string, limit: number, offset: number): Promise<Patient[]> {
    const { rows } = await db.query<PatientRow>(`SELECT ${COLUMNS} FROM patients p JOIN reception_patient_enrollments e ON e.patient_id=p.id JOIN careers c ON c.id=e.career_id WHERE c.code=$1 ORDER BY p.apellidos,p.nombres,p.id LIMIT $2 OFFSET $3`, [career, limit, offset]);
    return rows.map(mapPatient);
  }
  async findEnrolled(db: Queryable, id: string, career: string): Promise<Patient | null> {
    const { rows } = await db.query<PatientRow>(`SELECT ${COLUMNS} FROM patients p JOIN reception_patient_enrollments e ON e.patient_id=p.id JOIN careers c ON c.id=e.career_id WHERE p.id=$1 AND c.code=$2 FOR UPDATE OF p`, [id, career]);
    return rows.length ? mapPatient(rows[0]) : null;
  }
  async updateContact(db: Queryable, id: string, career: string, input: { email: string; celular: string; direccion: string }, actorId: string): Promise<Patient | null> {
    const { rows } = await db.query<PatientRow>(`UPDATE patients p SET email=$3,celular=$4,direccion=$5,updated_by=$6,updated_at=clock_timestamp()
      WHERE p.id=$1 AND EXISTS (SELECT 1 FROM reception_patient_enrollments e JOIN careers c ON c.id=e.career_id WHERE e.patient_id=p.id AND c.code=$2)
      RETURNING ${COLUMNS}`, [id, career, input.email, input.celular, input.direccion, actorId]);
    if (!rows.length) return null;
    return mapPatient(rows[0]);
  }
}
function mapPatient(row: PatientRow): Patient {
  const date = row.fecha_nacimiento instanceof Date
    ? `${row.fecha_nacimiento.getFullYear()}-${String(row.fecha_nacimiento.getMonth() + 1).padStart(2, '0')}-${String(row.fecha_nacimiento.getDate()).padStart(2, '0')}`
    : String(row.fecha_nacimiento).slice(0, 10);
  return new Patient({ id: row.id, documento: row.documento, nombres: row.nombres, apellidos: row.apellidos, fechaNacimiento: date, email: row.email, celular: row.celular, sexo: row.sexo, direccion: row.direccion, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at });
}
