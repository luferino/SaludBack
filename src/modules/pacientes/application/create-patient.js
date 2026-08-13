import { Patient } from '../domain/patient.js';
import { BadRequestError, ConflictError } from '../../shared/domain/errors.js';

const REQUIRED_FIELDS = [
  'documento',
  'nombres',
  'apellidos',
  'fecha_nacimiento',
  'email',
  'celular',
  'sexo',
  'direccion',
];

/**
 * Create Patient use case.
 * Staff-originated alta of personal data: validate the eight required
 * fields, reject duplicate documentos, persist. The repository port is
 * injected; the policy guard in front of it lives at route wiring.
 */
export class CreatePatient {
  constructor({ repository }) {
    this.repository = repository;
  }

  async execute(input = {}) {
    for (const field of REQUIRED_FIELDS) {
      const value = input[field];
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        throw new BadRequestError(`${field} is required`);
      }
    }

    const documento = String(input.documento).trim();
    if (!/^\d{4,8}$/.test(documento)) {
      throw new BadRequestError('documento must be 4-8 digits');
    }

    if (input.sexo !== 'M' && input.sexo !== 'F') {
      throw new BadRequestError('sexo must be M or F');
    }

    const fechaNacimiento = validateBirthDate(input.fecha_nacimiento);

    if (!/^[^@\s]+@[^@\s]+$/.test(input.email)) {
      throw new BadRequestError('email must be a valid local@domain address');
    }

    const existing = await this.repository.findByDocumento(documento);
    if (existing) {
      throw new ConflictError(`documento already exists: ${documento}`);
    }

    const patient = Patient.create({
      documento,
      nombres: input.nombres,
      apellidos: input.apellidos,
      fechaNacimiento,
      email: input.email,
      celular: input.celular,
      sexo: input.sexo,
      direccion: input.direccion,
      createdBy: input.createdBy ?? null,
    });

    return this.repository.create(patient);
  }
}

/**
 * Validates a strict `YYYY-MM-DD` birth date: real calendar date and not
 * in the future. Validation uses UTC components so impossible dates like
 * `2026-02-31` are rejected instead of silently rolling over.
 */
function validateBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestError('fecha_nacimiento must be a valid YYYY-MM-DD date');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isRealDate) {
    throw new BadRequestError('fecha_nacimiento must be a valid YYYY-MM-DD date');
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > todayUtc) {
    throw new BadRequestError('fecha_nacimiento cannot be in the future');
  }

  return value;
}
