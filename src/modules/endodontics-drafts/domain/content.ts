import { BadRequestError } from '../../shared/domain/errors.js';

const TEXT_LIMIT = 4000;
const LONE_SURROGATE = /\p{Cs}/u;
const ANSWERS = new Set(['current_treatment', 'medication', 'medication_allergy', 'recent_hospitalization',
  'previous_operation', 'cardiovascular', 'hematologic', 'neurologic', 'respiratory', 'gastrointestinal',
  'endocrine', 'urinary', 'musculoskeletal', 'eye_ear_nose_throat', 'social', 'infectious']);
const COMPLAINT_ANSWERS = new Set(['prior_anesthesia_reaction', 'treatment_trauma', 'prior_endodontic_treatment', 'dental_trauma']);
const EXAM_ANSWERS = new Set(['protective_material', 'trauma', 'periodontal_pocket', 'coronal_palpation', 'periapical_palpation',
  'coronal_percussion', 'periapical_percussion', 'vertical_mobility', 'horizontal_mobility', 'atm_pain',
  'mouth_opening_pain', 'midline_deviation', 'cavity_test', 'anesthesia_test']);
const TEXT_FIELDS: Record<string, Set<string>> = {
  patient_history: new Set(['responsible_physician', 'physician_phone', 'general_health', 'current_treatment_reason',
    'medication_name_reason', 'allergy_detail', 'hospitalization_reason', 'last_medical_exam', 'blood_pressure',
    'operation_reason', 'smoking_years', 'cigarettes_per_day', 'alcohol_type', 'alcohol_amount_per_day',
    'other_habits', 'drugs_type', 'drug_dependency', 'cardiovascular_detail', 'hematologic_detail', 'neurologic_detail',
    'respiratory_detail', 'gastrointestinal_detail', 'endocrine_detail', 'urinary_detail', 'musculoskeletal_detail',
    'eye_ear_nose_throat_detail', 'social_detail', 'infectious_detail']),
  complaint: new Set(['chief_complaint', 'reason_for_treatment', 'pain_location', 'onset', 'provoking_factor',
    'relieving_factor', 'frequency', 'time_since_onset', 'expectations']),
  examination: new Set(['protective_material_type', 'pocket_depth', 'observations']),
  vitality: new Set(['observations']),
  radiography: new Set(['notes']),
  pain: new Set(['location', 'onset', 'provoking_factor', 'relieving_factor', 'frequency', 'time_since_onset']),
};
const TOP = new Set(['patient_history', 'complaint', 'examination', 'vitality', 'radiography', 'pain',
  'tooth_or_region', 'probable_diagnosis', 'diagnosis_other_text', 'proposed_plan', 'plan_other_text', 'teacher_observations']);
const OBJECT_FIELDS = new Set(['patient_history', 'complaint', 'examination', 'vitality', 'radiography', 'pain']);
const FIELDS: Record<string, Set<string>> = {
  patient_history: new Set([...ANSWERS, ...TEXT_FIELDS.patient_history]),
  complaint: new Set([...COMPLAINT_ANSWERS, ...TEXT_FIELDS.complaint]),
  examination: new Set(['tooth_structure', 'color', 'edema', 'fistula', 'caries_depth', 'protective_material',
    'protective_material_type', 'restorative_material', 'wear', 'trauma', 'periodontal_pocket', 'pocket_depth',
    'hygiene', 'coronal_palpation', 'periapical_palpation', 'coronal_percussion', 'periapical_percussion',
    'edema_evolution', 'vertical_mobility', 'horizontal_mobility', 'atm_pain', 'mouth_opening_pain',
    'midline_deviation', 'observations']),
  vitality: new Set(['cold', 'heat', 'electric', 'cavity_test', 'anesthesia_test', 'observations']),
  radiography: new Set(['chamber', 'canals', 'periapical', 'notes']),
  pain: new Set(['intensity', 'distribution', 'trigger', 'duration', 'pattern', ...TEXT_FIELDS.pain]),
};
const ENUM_FIELDS: Record<string, Record<string, readonly string[]>> = {
  examination: {
    tooth_structure: ['intact', 'decayed', 'restored', 'fractured'],
    color: ['normal', 'modified'],
    edema: ['local', 'diffuse', 'mucosal', 'cutaneous'],
    fistula: ['intraoral', 'extraoral'],
    caries_depth: ['shallow', 'medium', 'deep'],
    restorative_material: ['amalgam', 'resin', 'other'],
    wear: ['erosion', 'abrasion', 'attrition'],
    hygiene: ['good', 'regular', 'poor'],
    edema_evolution: ['evolving', 'absent', 'evolved'],
  },
  pain: {
    distribution: ['localized', 'diffuse'],
    trigger: ['provoked', 'spontaneous'],
    duration: ['short', 'long'],
    pattern: ['intermittent', 'continuous'],
  },
};
const RADIO: Record<string, readonly string[]> = {
  chamber: ['normal_wide', 'narrow', 'calcified', 'calculus', 'filled', 'decayed', 'absent', 'destroyed'],
  canals: ['normal_wide', 'narrow', 'internal_resorption', 'external_resorption', 'fully_filled', 'partly_filled', 'incomplete_rhizogenesis', 'osteosclerosis'],
  periapical: ['normal', 'widened_ligament_space', 'hypercementosis', 'periapical_bone_resorption', 'diffuse_rarefaction', 'circumscribed_rarefaction', 'condensing_osteitis'],
};
const VITALITY_MARKS = new Set(['relief', 'stimulus']);
const DIAGNOSES = new Set(['normal_pulp_prosthetic_aesthetic', 'reversible_pulpitis_pulpal_wound',
  'reversible_pulpitis_inflammatory', 'reversible_pulpitis_incipient', 'irreversible_pulpitis_acute',
  'irreversible_pulpitis_acute_abscessed', 'irreversible_pulpitis_chronic_ulcerated', 'irreversible_pulpitis_hyperplastic',
  'mortified_pulp_necrosis', 'mortified_pulp_gangrene', 'acute_apical_periodontitis',
  'acute_dento_alveolar_abscess_initial', 'acute_dento_alveolar_abscess_evolving', 'acute_dento_alveolar_abscess_evolved',
  'chronic_abscess_fistula', 'probable_cyst', 'probable_granuloma', 'chronic_process_exacerbation', 'apical_scar',
  'prior_treatment_failure', 'iatrogenesis', 'other']);
const PLANS = new Set(['deep_caries_treatment', 'indirect_pulp_protection', 'direct_pulp_protection',
  'intentional_extirpation', 'pulpotomy', 'partial_biopulpectomy', 'total_biopulpectomy', 'necropulpectomy',
  'apexogenesis', 'apexification', 'retreatment', 'paraendodontic_surgery', 'clinical_control',
  'radiographic_control', 'referral', 'other']);

export type DraftContent = Record<string, unknown>;
export function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestError(`${field} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): void {
  if (value !== null && (typeof value !== 'string' || [...value].length > TEXT_LIMIT
      || value.includes('\0') || LONE_SURROGATE.test(value))) {
    throw new BadRequestError(`${field} must be text of at most ${TEXT_LIMIT} characters without NUL, or null`);
  }
}
function answer(value: unknown, field: string): void {
  if (value !== null && typeof value !== 'boolean') throw new BadRequestError(`${field} must be boolean or null`);
}
function option(value: unknown, field: string, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new BadRequestError(`${field} must be one of: ${allowed.join(', ')}, or null`);
}
function optionList(value: unknown, field: string, allowed: ReadonlySet<string> | readonly string[]): void {
  const permits = (item: string) => typeof (allowed as ReadonlySet<string>).has === 'function'
    ? (allowed as ReadonlySet<string>).has(item) : (allowed as readonly string[]).includes(item);
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !permits(item))
      || new Set(value).size !== value.length) {
    throw new BadRequestError(`${field} must be an array of unique printed options`);
  }
}
function validateObject(section: string, value: unknown): Record<string, unknown> {
  const fields = object(value, section);
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(fields)) {
    if (!FIELDS[section]?.has(key)) throw new BadRequestError(`unknown content field: ${section}.${key}`);
    const field = `${section}.${key}`;
    if (ANSWERS.has(key) && section === 'patient_history' || COMPLAINT_ANSWERS.has(key) && section === 'complaint'
        || EXAM_ANSWERS.has(key) && (section === 'examination' || section === 'vitality')) {
      answer(entry, field);
    } else if (TEXT_FIELDS[section]?.has(key)) {
      text(entry, field);
    } else if (section === 'pain' && key === 'intensity') {
      if (entry !== null && (!Number.isInteger(entry) || (entry as number) < 0 || (entry as number) > 10)) {
        throw new BadRequestError('pain.intensity must be an integer from 0 to 10, or null');
      }
    } else if (ENUM_FIELDS[section]?.[key]) {
      if (entry === null) { normalized[key] = null; continue; }
      const allowed = ENUM_FIELDS[section][key];
      if (['edema', 'fistula', 'wear'].includes(key)) optionList(entry, field, new Set(allowed));
      else option(entry, field, allowed);
    } else if (section === 'vitality' && ['cold', 'heat', 'electric'].includes(key)) {
      optionList(entry, field, VITALITY_MARKS);
    } else if (section === 'radiography' && key !== 'notes') {
      optionList(entry, field, new Set(RADIO[key]));
    }
    normalized[key] = entry;
  }
  return normalized;
}

function diagnosisPlan(value: unknown, field: string, options: ReadonlySet<string>): string[] {
  optionList(value, field, options);
  return [...value as string[]];
}

export function validateContent(value: unknown): DraftContent {
  const input = object(value, 'content');
  const result: DraftContent = {};
  for (const [key, value] of Object.entries(input)) {
    if (!TOP.has(key)) throw new BadRequestError(`unknown content section: ${key}`);
    if (OBJECT_FIELDS.has(key)) result[key] = validateObject(key, value);
    else if (key === 'tooth_or_region' || key === 'diagnosis_other_text' || key === 'plan_other_text' || key === 'teacher_observations') {
      text(value, key); result[key] = value;
    } else if (key === 'probable_diagnosis') result[key] = diagnosisPlan(value, key, DIAGNOSES);
    else if (key === 'proposed_plan') result[key] = diagnosisPlan(value, key, PLANS);
  }
  return result;
}
