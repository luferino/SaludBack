import { BadRequestError } from '../../shared/domain/errors.js';

export interface EvaluationContent {
  admission_date?: string | null;
  admission_status?: string | null;
  illness_history?: string | null;
  medical_diagnosis?: string | null;
  kinesiology_diagnosis?: string | null;
  objectives?: string | null;
  proposed_treatment?: string | null;
  occupation?: string | null;
  referring_physician?: string | null;
  antecedents?: {
    hta?: boolean | null;
    dbt?: boolean | null;
    diu?: boolean | null;
    sedentary_lifestyle?: boolean | null;
    pacemaker?: boolean | null;
    other?: string | null;
  };
  studies?: Array<{ type: string; description: string; date?: string | null }>;
}

export interface PatientDemographics {
  id: string;
  documento: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: Date | string;
  email: string;
  celular: string;
  sexo: string;
  direccion: string;
}

export interface Evaluation {
  id: string;
  patient?: PatientDemographics;
  clinical_record_id: string;
  patient_id: string;
  author_id: string;
  origin_student_habilitation_id: string;
  origin_subject_id: string;
  origin_group_id: string;
  content: EvaluationContent;
  created_at: Date | string;
  updated_at: Date | string;
  status?: 'draft' | 'submitted' | 'validated';
  amendment_of_evaluation_id?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) throw new BadRequestError(`${field} must be an object`);
  return value;
}

export function validateDate(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`${field} must be a valid YYYY-MM-DD date or null`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestError(`${field} must be a valid YYYY-MM-DD date or null`);
  }
  return value;
}

export function validateContent(value: unknown): EvaluationContent {
  const input = requireObject(value, 'content');
  const textFields = [
    'admission_status', 'illness_history', 'medical_diagnosis', 'kinesiology_diagnosis',
    'objectives', 'proposed_treatment', 'occupation', 'referring_physician',
  ];
  const allowed = new Set([...textFields, 'admission_date', 'antecedents', 'studies']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new BadRequestError(`unknown content field: ${key}`);
  }
  const output: Record<string, unknown> = {};
  for (const key of textFields) {
    if (!Object.hasOwn(input, key)) continue;
    const field = input[key];
    if (field !== null && typeof field !== 'string') throw new BadRequestError(`${key} must be a string or null`);
    output[key] = field;
  }
  if (Object.hasOwn(input, 'admission_date')) output.admission_date = validateDate(input.admission_date, 'admission_date');

  if (Object.hasOwn(input, 'antecedents')) {
    const antecedents = requireObject(input.antecedents, 'antecedents');
    const names = ['hta', 'dbt', 'diu', 'sedentary_lifestyle', 'pacemaker', 'other'];
    for (const name of Object.keys(antecedents)) {
      if (!names.includes(name)) throw new BadRequestError(`unknown antecedent: ${name}`);
    }
    const typed: Record<string, unknown> = {};
    for (const name of names) {
      if (!Object.hasOwn(antecedents, name)) continue;
      const field = antecedents[name];
      if (name === 'other') {
        if (field !== null && typeof field !== 'string') throw new BadRequestError('antecedents.other must be a string or null');
      } else if (field !== null && typeof field !== 'boolean') {
        throw new BadRequestError(`antecedents.${name} must be a boolean or null`);
      }
      typed[name] = field;
    }
    output.antecedents = typed;
  }

  if (Object.hasOwn(input, 'studies')) {
    if (!Array.isArray(input.studies)) throw new BadRequestError('studies must be an array');
    output.studies = input.studies.map((study, index) => {
      const item = requireObject(study, `studies[${index}]`);
      if (Object.keys(item).some(key => !['type', 'description', 'date'].includes(key))) {
        throw new BadRequestError(`studies[${index}] has unknown fields`);
      }
      if (typeof item.type !== 'string' || !item.type.trim()) throw new BadRequestError(`studies[${index}].type must be a non-empty string`);
      if (typeof item.description !== 'string' || !item.description.trim()) throw new BadRequestError(`studies[${index}].description must be a non-empty string`);
      const date = Object.hasOwn(item, 'date') ? validateDate(item.date, `studies[${index}].date`) : undefined;
      return { type: item.type, description: item.description, ...(date === undefined ? {} : { date }) };
    });
  }
  return output as EvaluationContent;
}

export function dateOnly(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ageAtAdmission(birthDate: Date | string, admissionDate?: string | null): number | null {
  if (!admissionDate) return null;
  const birth = new Date(`${dateOnly(birthDate)}T00:00:00Z`);
  const admission = new Date(`${admissionDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(admission.getTime())) return null;
  let age = admission.getUTCFullYear() - birth.getUTCFullYear();
  if (admission.getUTCMonth() < birth.getUTCMonth() ||
    (admission.getUTCMonth() === birth.getUTCMonth() && admission.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export function submissionContent(value: unknown): EvaluationContent {
  const content = validateContent(value);
  if (!content.admission_date) throw new BadRequestError('admission_date is required for submission');
  for (const field of ['illness_history', 'admission_status', 'objectives', 'proposed_treatment'] as const) {
    if (typeof content[field] !== 'string' || !content[field]!.trim()) {
      throw new BadRequestError(`${field} is required for submission`);
    }
  }
  return content;
}
