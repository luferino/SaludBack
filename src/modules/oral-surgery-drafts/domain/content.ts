import { BadRequestError } from '../../shared/domain/errors.js';

const fields = {
  medical_history: {
    boolean: ['hospitalized', 'taking_medication', 'has_disease', 'cardiopathy', 'myocardial_infarction',
      'angina', 'pacemaker', 'hypertension', 'asthma', 'sinusitis', 'dialysis',
      'medication_allergy', 'anesthetic_allergy', 'food_allergy', 'previous_dental_anesthesia',
      'anemia', 'hemorrhage', 'hematomas', 'epilepsy', 'convulsions', 'nervous_disease',
      'tuberculosis', 'syphilis', 'hepatitis', 'pregnant', 'prenatal_care'],
    text: ['consultation_reason', 'hospitalization_reason', 'medication', 'medication_duration',
      'disease_description', 'other_anesthesia_procedures', 'nervous_disease_type',
      'other_infectious_diseases', 'pregnancy_duration', 'other_diseases'],
  },
  complementary_tests: { boolean: ['laboratory', 'periapical_radiographs', 'panoramic_radiographs', 'tomography'],
    text: ['blood_group'] },
  extraoral_exam: { boolean: ['facial_symmetry'], text: ['skin', 'nose', 'eyes', 'ears',
    'salivary_glands', 'lymph_nodes', 'maxillary_sinus'] },
  intraoral_exam: { boolean: [], text: ['lips', 'periodontium', 'tongue', 'oral_mucosa',
    'mouth_opening', 'prosthesis', 'other'] },
  preoperative: { boolean: ['vital'], text: ['tooth', 'cc_rr', 'multiple_teeth', 'crown_condition',
    'root_condition', 'gingival_mucosa', 'tooth_diagnosis', 'systolic_pressure',
    'diastolic_pressure', 'pulse_per_minute', 'temperature'] },
  treatment_plan: { boolean: [], text: ['procedure', 'anomalies_or_pathology'] },
} as const;

export type DraftContent = Record<string, string | null | Record<string, string | boolean | null>>;

export function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestError(`${field} must be an object`);
  return value as Record<string, unknown>;
}

// A draft has no clinical completeness requirements. Omission, null and false stay distinct.
export function validateContent(value: unknown): DraftContent {
  const input = object(value, 'content');
  const result: DraftContent = {};
  for (const [section, entry] of Object.entries(input)) {
    if (section === 'admission_date') {
      if (entry !== null && (typeof entry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry)
          || !Number.isFinite(Date.parse(entry)) || new Date(entry).toISOString().slice(0, 10) !== entry)) {
        throw new BadRequestError('admission_date must be a valid YYYY-MM-DD date or null');
      }
      result[section] = entry as string | null;
      continue;
    }
    if (!Object.hasOwn(fields, section)) throw new BadRequestError(`unknown content section: ${section}`);
    const schema = fields[section as keyof typeof fields];
    const values = object(entry, section);
    const normalized: Record<string, string | boolean | null> = {};
    for (const [key, answer] of Object.entries(values)) {
      if ((schema.boolean as readonly string[]).includes(key)) {
        if (answer !== null && typeof answer !== 'boolean') throw new BadRequestError(`${section}.${key} must be boolean or null`);
      } else if ((schema.text as readonly string[]).includes(key)) {
        // Count Unicode characters, not UTF-16 units; PostgreSQL JSON text cannot hold NUL.
        if (answer !== null && (typeof answer !== 'string' || [...answer].length > 4000 || answer.includes('\u0000'))) {
          throw new BadRequestError(`${section}.${key} must be text of at most 4000 characters without NUL, or null`);
        }
      } else throw new BadRequestError(`unknown content field: ${section}.${key}`);
      normalized[key] = answer as string | boolean | null;
    }
    result[section] = normalized;
  }
  return result;
}
