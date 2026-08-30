import type { Pool } from 'pg';
import { Patient } from '../../domain/patient.entity.js';
import type { PatientRepositoryPort } from '../../application/patient.ports.js';

interface PatientRow {
  id: string;
  documento: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: Date | string;
  email: string;
  celular: string;
  sexo: string;
  direccion: string;
  created_by: string | null;
  created_at: Date | string;
  updated_by: string | null;
  updated_at: Date | string | null;
}

const PATIENT_COLUMNS =
  'id, documento, nombres, apellidos, fecha_nacimiento, email, celular, sexo, direccion, created_by, created_at, updated_by, updated_at';

/**
 * PostgreSQL implementation of the PatientRepository port.
 * Receives a `pg` Pool (or any duck-typed `{ query }`) via constructor
 * injection so tests can pass a fake pool.
 */
export class PgPatientRepository implements PatientRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findByDocumento(documento: string): Promise<Patient | null> {
    const { rows } = await this.pool.query<PatientRow>(
      `SELECT ${PATIENT_COLUMNS} FROM patients WHERE documento = $1`,
      [documento],
    );
    return rows.length === 0 ? null : rowToPatient(rows[0]);
  }

  async create(patient: Patient): Promise<Patient> {
    const { rows } = await this.pool.query<PatientRow>(
      `INSERT INTO patients (documento, nombres, apellidos, fecha_nacimiento, email, celular, sexo, direccion, created_by, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${PATIENT_COLUMNS}`,
      [
        patient.documento,
        patient.nombres,
        patient.apellidos,
        patient.fechaNacimiento,
        patient.email,
        patient.celular,
        patient.sexo,
        patient.direccion,
        patient.createdBy,
        patient.updatedBy,
        patient.updatedAt,
      ],
    );
    return rowToPatient(rows[0]);
  }
}

function rowToPatient(row: PatientRow): Patient {
  return new Patient({
    id: row.id,
    documento: row.documento,
    nombres: row.nombres,
    apellidos: row.apellidos,
    fechaNacimiento: toDateString(row.fecha_nacimiento) ?? '',
    email: row.email,
    celular: row.celular,
    sexo: row.sexo,
    direccion: row.direccion,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
}

/**
 * Normalizes a pg DATE value (JS Date at local midnight) to a `YYYY-MM-DD`
 * string so the entity never carries a time component.
 */
function toDateString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
