/**
 * Patient aggregate root. Plain entity with no dependencies so it stays
 * trivially testable; repositories map rows to and from this shape.
 */
export class Patient {
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
    createdBy = null,
    createdAt = null,
  } = {}) {
    this.id = id;
    this.documento = documento;
    this.nombres = nombres;
    this.apellidos = apellidos;
    this.fechaNacimiento = fechaNacimiento;
    this.email = email;
    this.celular = celular;
    this.sexo = sexo;
    this.direccion = direccion;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
  }

  /** Builds a new (not yet persisted) patient. */
  static create({
    documento,
    nombres,
    apellidos,
    fechaNacimiento,
    email,
    celular,
    sexo,
    direccion,
    createdBy = null,
  }) {
    return new Patient({
      documento,
      nombres,
      apellidos,
      fechaNacimiento,
      email,
      celular,
      sexo,
      direccion,
      createdBy,
    });
  }

  /**
   * Serializes the patient for API responses. Explicit whitelist with
   * exactly the 11 PAT-006 contract keys; `created_by` is always present,
   * `null` when no actor recorded it. `fecha_nacimiento` serializes as
   * `YYYY-MM-DD` without a time component.
   */
  toJSON() {
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
function toDateString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
