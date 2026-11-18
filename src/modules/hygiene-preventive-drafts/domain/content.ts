import { BadRequestError } from '../../shared/domain/errors.js';

// Medical history answers: null means unanswered, false means No, and an omitted key means not captured.
// Every Sí answer admits an optional specify text.
const MEDICAL_BOOLEANS = ['taking_medication', 'allergy_local_anesthetic', 'allergy_penicillin', 'allergy_other_medication',
  'dental_treatment_problem', 'cardiovascular_disease', 'diabetes', 'hypertension', 'renal_disease', 'tuberculosis',
  'venereal_disease', 'blood_disease', 'other_disease', 'pregnant'] as const;
// In Unicode mode only unpaired surrogates match \p{Cs}; valid astral characters do not.
const LONE_SURROGATE = /\p{Cs}/u;
const MEDICAL_TEXT = [...MEDICAL_BOOLEANS.map(key => `${key}_detail`), 'treating_physician', 'observations'];

const PERMANENT_TEETH = [1, 2, 3, 4].flatMap(quadrant => Array.from({ length: 8 }, (_, i) => `${quadrant}${i + 1}`));
const DECIDUOUS_TEETH = [5, 6, 7, 8].flatMap(quadrant => Array.from({ length: 5 }, (_, i) => `${quadrant}${i + 1}`));
const FDI_CODES = new Set([...PERMANENT_TEETH, ...DECIDUOUS_TEETH]);
const TOOTH_STATES = ['present', 'absent', 'to_extract'] as const;
const SURFACES = ['occlusal', 'mesial', 'distal', 'vestibular', 'lingual'] as const;
const FINDINGS = ['caries', 'filled'] as const;

// Index components and totals follow the Hygiene and Preventive II form: ceo-d, CPO-D and CPO first molars.
const INDEXES = {
  ceo_d: { components: ['c', 'e', 'o'], limit: 20 },
  cpo_d: { components: ['c', 'p', 'o'], limit: 32 },
  cpo_first_molars: { components: ['c', 'p', 'o'], limit: 4 },
} as const;
type IndexName = keyof typeof INDEXES;

// Plaque indices follow page 3 of the form. Surface names reuse the odontogram names (lingual = palatal/lingual).
const LOE_SILNESS_TEETH = ['16', '21', '24', '36', '41', '44'] as const;
const LOE_SILNESS_SITES = ['distal', 'vestibular', 'mesial', 'lingual'] as const;
const OLEARY_SURFACES = ['mesial', 'distal', 'vestibular', 'lingual'] as const;
const PLAQUE_COMPUTED = {
  loe_silness: ['average', 'category'],
  oleary: ['stained_surfaces', 'present_surfaces', 'percentage', 'category'],
} as const;
type PlaqueName = keyof typeof PLAQUE_COMPUTED;

export type ToothState = (typeof TOOTH_STATES)[number];
export type Finding = (typeof FINDINGS)[number];
export interface Tooth { state: ToothState; surfaces?: Partial<Record<(typeof SURFACES)[number], Finding[]>> }
export interface DraftContent {
  medical_history?: Record<string, boolean | string | null>;
  odontogram?: Record<string, Tooth>;
  indices?: Partial<Record<IndexName, Record<string, number> | null>>;
  plaque?: Partial<Record<PlaqueName, { teeth: Record<string, Record<string, number | boolean>> } | null>>;
}

export function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestError(`${field} must be an object`);
  return value as Record<string, unknown>;
}

// A draft has no clinical completeness requirements. Omission, null and false stay distinct.
export function validateContent(value: unknown): DraftContent {
  const input = object(value, 'content');
  const result: DraftContent = {};
  for (const [section, entry] of Object.entries(input)) {
    if (section === 'medical_history') result.medical_history = medicalHistory(entry);
    else if (section === 'odontogram') result.odontogram = odontogram(entry);
    else if (section === 'indices') result.indices = indices(entry);
    else if (section === 'plaque') result.plaque = plaque(entry);
    else throw new BadRequestError(`unknown content section: ${section}`);
  }
  return result;
}

function medicalHistory(entry: unknown): Record<string, boolean | string | null> {
  const values = object(entry, 'medical_history');
  const normalized: Record<string, boolean | string | null> = {};
  for (const [key, answer] of Object.entries(values)) {
    if ((MEDICAL_BOOLEANS as readonly string[]).includes(key)) {
      if (answer !== null && typeof answer !== 'boolean') throw new BadRequestError(`medical_history.${key} must be boolean or null`);
    } else if ((MEDICAL_TEXT as readonly string[]).includes(key)) {
      // Count Unicode characters, not UTF-16 units; PostgreSQL JSON text cannot hold NUL or lone surrogates.
      if (answer !== null && (typeof answer !== 'string' || [...answer].length > 4000 || answer.includes('\u0000')
          || LONE_SURROGATE.test(answer))) {
        throw new BadRequestError(`medical_history.${key} must be text of at most 4000 characters without NUL, or null`);
      }
    } else throw new BadRequestError(`unknown content field: medical_history.${key}`);
    normalized[key] = answer as boolean | string | null;
  }
  return normalized;
}

// Only recorded teeth appear; an omitted tooth is unrecorded, never healthy.
function odontogram(entry: unknown): Record<string, Tooth> {
  const teeth = object(entry, 'odontogram');
  const normalized: Record<string, Tooth> = {};
  for (const [code, tooth] of Object.entries(teeth)) {
    if (!FDI_CODES.has(code)) throw new BadRequestError(`odontogram.${code} is not a valid FDI tooth code`);
    normalized[code] = recordedTooth(code, tooth);
  }
  return normalized;
}

function recordedTooth(code: string, tooth: unknown): Tooth {
  const field = `odontogram.${code}`;
  const values = object(tooth, field);
  for (const key of Object.keys(values)) {
    if (key !== 'state' && key !== 'surfaces') throw new BadRequestError(`unknown content field: ${field}.${key}`);
  }
  if (typeof values.state !== 'string' || !(TOOTH_STATES as readonly string[]).includes(values.state)) {
    throw new BadRequestError(`${field}.state must be present, absent or to_extract`);
  }
  const result: Tooth = { state: values.state as ToothState };
  if (Object.hasOwn(values, 'surfaces')) result.surfaces = surfaces(code, values.surfaces);
  if (result.state === 'absent' && Object.keys(result.surfaces ?? {}).length > 0) {
    throw new BadRequestError(`${field} is absent and cannot have marked surfaces`);
  }
  return result;
}

function surfaces(code: string, value: unknown): NonNullable<Tooth['surfaces']> {
  const field = `odontogram.${code}.surfaces`;
  const faces = object(value, field);
  const normalized: NonNullable<Tooth['surfaces']> = {};
  for (const [face, findings] of Object.entries(faces)) {
    if (!(SURFACES as readonly string[]).includes(face)) throw new BadRequestError(`unknown content field: ${field}.${face}`);
    const list = Array.isArray(findings) ? findings as unknown[] : null;
    if (!list || list.length === 0 || new Set(list).size !== list.length
        || list.some(finding => !(FINDINGS as readonly unknown[]).includes(finding))) {
      throw new BadRequestError(`${field}.${face} must be a non-empty array of unique caries or filled values`);
    }
    normalized[face as (typeof SURFACES)[number]] = list as Finding[];
  }
  return normalized;
}

function indices(value: unknown): NonNullable<DraftContent['indices']> {
  const input = object(value, 'indices');
  const normalized: NonNullable<DraftContent['indices']> = {};
  for (const [index, entry] of Object.entries(input)) {
    if (!Object.hasOwn(INDEXES, index)) throw new BadRequestError(`unknown content field: indices.${index}`);
    const spec = INDEXES[index as IndexName];
    if (entry === null) { normalized[index as IndexName] = null; continue; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestError(`indices.${index} must be an object or null`);
    const values = entry as Record<string, unknown>;
    for (const key of Object.keys(values)) {
      if (key === 'total') throw new BadRequestError(`indices.${index}.total is computed by the server and must not be sent`);
      if (!(spec.components as readonly string[]).includes(key)) throw new BadRequestError(`unknown content field: indices.${index}.${key}`);
    }
    const component: Record<string, number> = {};
    let sum = 0;
    for (const key of spec.components) {
      const count = values[key];
      if (!Number.isSafeInteger(count) || (count as number) < 0) {
        throw new BadRequestError(`indices.${index}.${key} must be a non-negative safe integer`);
      }
      component[key] = count as number;
      sum += count as number;
    }
    if (sum > spec.limit) throw new BadRequestError(`indices.${index} total must be at most ${spec.limit}`);
    normalized[index as IndexName] = component;
  }
  return normalized;
}

// Only the recorded teeth are stored; averages, percentages and categories are computed on read.
function plaque(value: unknown): NonNullable<DraftContent['plaque']> {
  const input = object(value, 'plaque');
  const normalized: NonNullable<DraftContent['plaque']> = {};
  for (const [section, entry] of Object.entries(input)) {
    if (!Object.hasOwn(PLAQUE_COMPUTED, section)) throw new BadRequestError(`unknown content field: plaque.${section}`);
    const name = section as PlaqueName;
    if (entry === null) { normalized[name] = null; continue; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestError(`plaque.${name} must be an object or null`);
    for (const key of Object.keys(entry)) {
      if ((PLAQUE_COMPUTED[name] as readonly string[]).includes(key)) {
        throw new BadRequestError(`plaque.${name}.${key} is computed by the server and must not be sent`);
      }
      if (key !== 'teeth') throw new BadRequestError(`unknown content field: plaque.${name}.${key}`);
    }
    const teeth = object((entry as Record<string, unknown>).teeth, `plaque.${name}.teeth`);
    normalized[name] = { teeth: name === 'loe_silness' ? loeSilnessTeeth(teeth) : olearyTeeth(teeth) };
  }
  return normalized;
}

// An omitted tooth or site is not present and is excluded from the average.
function loeSilnessTeeth(teeth: Record<string, unknown>): Record<string, Record<string, number>> {
  const normalized: Record<string, Record<string, number>> = {};
  for (const [code, tooth] of Object.entries(teeth)) {
    const field = `plaque.loe_silness.teeth.${code}`;
    if (!(LOE_SILNESS_TEETH as readonly string[]).includes(code)) {
      throw new BadRequestError(`${field} must be one of ${LOE_SILNESS_TEETH.join(', ')}`);
    }
    const sites = object(tooth, field);
    const grades: Record<string, number> = {};
    for (const [site, grade] of Object.entries(sites)) {
      if (!(LOE_SILNESS_SITES as readonly string[]).includes(site)) throw new BadRequestError(`unknown content field: ${field}.${site}`);
      if (!Number.isInteger(grade) || (grade as number) < 0 || (grade as number) > 3) {
        throw new BadRequestError(`${field}.${site} must be an integer grade from 0 to 3`);
      }
      grades[site] = grade as number;
    }
    normalized[code] = grades;
  }
  return normalized;
}

// A recorded tooth is present and must report all four surfaces; an omitted tooth is absent or not evaluated.
function olearyTeeth(teeth: Record<string, unknown>): Record<string, Record<string, boolean>> {
  const normalized: Record<string, Record<string, boolean>> = {};
  for (const [code, tooth] of Object.entries(teeth)) {
    const field = `plaque.oleary.teeth.${code}`;
    if (!FDI_CODES.has(code)) throw new BadRequestError(`${field} is not a valid FDI tooth code`);
    const values = object(tooth, field);
    for (const key of Object.keys(values)) {
      if (!(OLEARY_SURFACES as readonly string[]).includes(key)) throw new BadRequestError(`unknown content field: ${field}.${key}`);
    }
    const surfaces: Record<string, boolean> = {};
    for (const surface of OLEARY_SURFACES) {
      if (typeof values[surface] !== 'boolean') throw new BadRequestError(`${field}.${surface} must be boolean`);
      surfaces[surface] = values[surface] as boolean;
    }
    normalized[code] = surfaces;
  }
  return normalized;
}

// The category is derived from the rounded value returned, so the shown value and category never disagree.
function loeSilnessResult(teeth: Record<string, Record<string, number | boolean>>) {
  const grades = Object.values(teeth).flatMap(sites => Object.values(sites) as number[]);
  if (grades.length === 0) return { average: null, category: null };
  const average = Math.round(grades.reduce((sum, grade) => sum + grade, 0) * 100 / grades.length) / 100;
  return { average, category: average <= 0.5 ? 'low' : average <= 1.5 ? 'moderate' : 'abundant' };
}

function olearyResult(teeth: Record<string, Record<string, number | boolean>>) {
  const surfaces = Object.values(teeth).flatMap(tooth => Object.values(tooth));
  const stained = surfaces.filter(Boolean).length;
  if (surfaces.length === 0) return { stained_surfaces: 0, present_surfaces: 0, percentage: null, category: null };
  const percentage = Math.round(stained * 1000 / surfaces.length) / 10;
  return { stained_surfaces: stained, present_surfaces: surfaces.length, percentage,
    category: percentage <= 30 ? 'good' : percentage <= 60 ? 'fair' : 'poor' };
}

// The server owns derived values: index totals and plaque averages, percentages and categories.
export function withComputedValues(content: DraftContent): DraftContent {
  const result: DraftContent = { ...content };
  if (content.indices) {
    const indices: NonNullable<DraftContent['indices']> = {};
    for (const [index, value] of Object.entries(content.indices)) {
      if (value === null || value === undefined) { indices[index as IndexName] = null; continue; }
      const { components } = INDEXES[index as IndexName];
      indices[index as IndexName] = { ...value, total: components.reduce((sum, key) => sum + value[key], 0) };
    }
    result.indices = indices;
  }
  if (content.plaque) {
    const plaque: Record<string, unknown> = {};
    for (const [section, value] of Object.entries(content.plaque)) {
      if (value === null || value === undefined) { plaque[section] = null; continue; }
      plaque[section] = { ...value, ...(section === 'loe_silness' ? loeSilnessResult(value.teeth) : olearyResult(value.teeth)) };
    }
    result.plaque = plaque as DraftContent['plaque'];
  }
  return result;
}
