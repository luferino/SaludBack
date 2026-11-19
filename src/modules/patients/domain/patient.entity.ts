import type { MaritalStatus, MedicalInsurance } from './personal-data.js';

/**
 * Patient aggregate root. Plain entity with no dependencies so it stays
 * trivially testable; repositories map rows to and from this shape.
 */
export class Patient {
  id: string | null;
  documento: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  email: string;
  celular: string;
  sexo: string;
  direccion: string;
  maritalStatus: MaritalStatus | null;
  medicalInsurance: MedicalInsurance | null;
  createdBy: string | null;
  createdAt: Date | string | null;
  updatedBy: string | null;
  updatedAt: Date | string | null;

  constructor({
    id = null,
    documento,
    nombres,
    apellidos,
    fechaNacimiento,
    email,
    celular,
    sexo,
    direccion,
    maritalStatus = null,
    medicalInsurance = null,
    createdBy = null,
    createdAt = null,
    updatedBy = null,
    updatedAt = null,
  }: {
    id?: string | null;
    documento: string;
    nombres: string;
    apellidos: string;
    fechaNacimiento: string;
    email: string;
    celular: string;
    sexo: string;
    direccion: string;
    maritalStatus?: MaritalStatus | null;
    medicalInsurance?: MedicalInsurance | null;
    createdBy?: string | null;
    createdAt?: Date | string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  } = {} as {
    id?: string | null;
    documento: string;
    nombres: string;
    apellidos: string;
    fechaNacimiento: string;
    email: string;
    celular: string;
    sexo: string;
    direccion: string;
    maritalStatus?: MaritalStatus | null;
    medicalInsurance?: MedicalInsurance | null;
    createdBy?: string | null;
    createdAt?: Date | string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  }) {
    this.id = id;
    this.documento = documento;
    this.nombres = nombres;
    this.apellidos = apellidos;
    this.fechaNacimiento = fechaNacimiento;
    this.email = email;
    this.celular = celular;
    this.sexo = sexo;
    this.direccion = direccion;
    this.maritalStatus = maritalStatus;
    this.medicalInsurance = medicalInsurance;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
    this.updatedBy = updatedBy;
    this.updatedAt = updatedAt;
  }

  /** Builds a new (not yet persisted) patient. Personal data defaults to not recorded (`null`). */
  static create({
    documento,
    nombres,
    apellidos,
    fechaNacimiento,
    email,
    celular,
    sexo,
    direccion,
    maritalStatus = null,
    medicalInsurance = null,
    createdBy = null,
  }: {
    documento: string;
    nombres: string;
    apellidos: string;
    fechaNacimiento: string;
    email: string;
    celular: string;
    sexo: string;
    direccion: string;
    maritalStatus?: MaritalStatus | null;
    medicalInsurance?: MedicalInsurance | null;
    createdBy?: string | null;
  }): Patient {
    return new Patient({
      documento,
      nombres,
      apellidos,
      fechaNacimiento,
      email,
      celular,
      sexo,
      direccion,
      maritalStatus,
      medicalInsurance,
      createdBy,
    });
  }

  /**
   * Serializes the patient for API responses. Explicit whitelist with
   * exactly the 13 contract keys: the 11 PAT-006 keys plus `marital_status`
   * and `medical_insurance` (personal data, `null` when not recorded).
   * `created_by` is always present, `null` when no actor recorded it.
   * `fecha_nacimiento` serializes as `YYYY-MM-DD` without a time component.
   * The update audit columns (`updated_by`/`updated_at`, PAT-007) are
   * internal bookkeeping and are never serialized (AUD-002).
   */
  toJSON(): {
    id: string | null;
    documento: string;
    nombres: string;
    apellidos: string;
    fecha_nacimiento: string | null;
    email: string;
    celular: string;
    sexo: string;
    direccion: string;
    marital_status: MaritalStatus | null;
    medical_insurance: MedicalInsurance | null;
    created_by: string | null;
    created_at: Date | string | null;
  } {
    return {
      id: this.id,
      documento: this.documento,
      nombres: this.nombres,
      apellidos: this.apellidos,
      fecha_nacimiento: toDateString(this.fechaNacimiento),
      email: this.email,
      celular: this.celular,
      sexo: this.sexo,
      direccion: this.direccion,
      marital_status: this.maritalStatus,
      medical_insurance: this.medicalInsurance,
      created_by: this.createdBy ?? null,
      created_at: this.createdAt,
    };
  }
}

/**
 * Normalizes a date-like value to a `YYYY-MM-DD` string. pg returns DATE
 * columns as JS Date instances (local midnight); serializing them raw
 * would leak a time component into the API contract.
 */
function toDateString(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
