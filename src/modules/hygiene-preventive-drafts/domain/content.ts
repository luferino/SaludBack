import { BadRequestError } from '../../shared/domain/errors.js';

// Medical history answers: null means unanswered, false means No, and an omitted key means not captured.
// Every Sí answer admits an optional specify text.
const MEDICAL_BOOLEANS = ['taking_medication', 'allergy_local_anesthetic', 'allergy_penicillin', 'allergy_other_medication',
  'dental_treatment_problem', 'cardiovascular_disease', 'diabetes', 'hypertension', 'renal_disease', 'tuberculosis',
  'venereal_disease', 'blood_disease', 'other_disease', 'pregnant'] as const;
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

export type ToothState = (typeof TOOTH_STATES)[number];
export type Finding = (typeof FINDINGS)[number];
export interface Tooth { state: ToothState; surfaces?: Partial<Record<(typeof SURFACES)[number], Finding[]>> }
export interface DraftContent {
  medical_history?: Record<string, boolean | string | null>;
  odontogram?: Record<string, Tooth>;
  indices?: Partial<Record<IndexName, Record<string, number> | null>>;
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
      // Count Unicode characters, not UTF-16 units; PostgreSQL JSON text cannot hold NUL.
      if (answer !== null && (typeof answer !== 'string' || [...answer].length > 4000 || answer.includes('\u0000'))) {
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

// The server owns totals: each loaded index is returned with the sum of its stored components.
export function withIndexTotals(content: DraftContent): DraftContent {
  if (!content.indices) return content;
  const indices: NonNullable<DraftContent['indices']> = {};
  for (const [index, value] of Object.entries(content.indices)) {
    if (value === null || value === undefined) { indices[index as IndexName] = null; continue; }
    const { components } = INDEXES[index as IndexName];
    indices[index as IndexName] = { ...value, total: components.reduce((sum, key) => sum + value[key], 0) };
  }
  return { ...content, indices };
}
