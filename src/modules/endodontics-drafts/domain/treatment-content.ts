import { BadRequestError } from '../../shared/domain/errors.js';
import { object } from './content.js';

// Field inventory from the Endodontics treatment page (odd/tasks/endodontics-treatment.md, L3). Header identity
// (date, patient, professional, contact pairs) and footer signature/date are intentionally absent: they are
// referenced from the existing patient and authenticated author, never copied into report content.
const TEXT_LIMIT = 4000;
const MAX_TREATED_TEETH = 8;
// Technical bound, not a clinical rule: 8 treated teeth x up to 8 canals each. L3 does not print a row count.
const MAX_CANAL_ROWS = 64;
const LONE_SURROGATE = /\p{Cs}/u;

const CHECKLISTS: Record<string, readonly string[]> = {
  instrumentation_technique: ['manual', 'rotary', 'oscillatory', 'hybrid', 'ultrasonic', 'laser'],
  // Rotary-system labels keep the printed spelling because the scan is low resolution; alternatives go in other_text.
  rotary_system: ['Free Tip', 'Protaper', 'K3', 'RACE', 'Endo IZE', 'Injecta'],
  modality: ['traditional', 'crown_down', 'step_back', 'stepped', 'double_stepped', 'goerig_et_al'],
  obturation_technique: ['lateral_condensation', 'vertical_condensation', 'thermomechanical', 'single_cone', 'injectable', 'cement_only'],
  irrigants: ['sodium_hypochlorite', 'detergent', 'edta', 'hydrogen_peroxide', 'chlorhexidine', 'lime_water'],
  intracanal_medication: ['calcium_hydroxide', 'pmcc', 'antibiotic', 'formocresol', 'corticosteroids', 'iodoform'],
  sealer: ['oze', 'calcium_hydroxide', 'glass_ionomer', 'resins', 'silicone', 'mta'],
};
const PERCENTAGES: Record<string, readonly string[]> = {
  irrigants: ['sodium_hypochlorite', 'edta', 'chlorhexidine'],
};
const ACCESS_ROWS = ['access_cavity_preparation', 'canal_entry_preparation', 'anticurvature_wear', 'other'] as const;
const ACCESS_COLUMNS = ['high_speed_bur', 'low_speed_bur', 'rotary_file', 'manual_file', 'other'] as const;
const CANAL_TEXT_COLUMNS = ['tooth', 'canal', 'reference_point', 'real_tooth_length', 'real_working_length',
  'apical_patency_instrument', 'initial_instrument', 'memory_instrument', 'final_instrument',
  'main_gutta_percha', 'accessory_gutta_percha'] as const;
const OBTURATION_CUTS = ['canal_entry', 'apex_mm'] as const;
const TEXT_SECTIONS = ['diagnosis', 'treatment_plan', 'accidents', 'observations'] as const;

export type TreatmentContent = Record<string, unknown>;

function bounded(value: unknown, field: string): string {
  if (typeof value !== 'string' || [...value].length > TEXT_LIMIT || value.includes('\0') || LONE_SURROGATE.test(value)) {
    throw new BadRequestError(`${field} must be text of at most ${TEXT_LIMIT} characters without NUL, or null`);
  }
  return value;
}

function text(value: unknown, field: string): string | null {
  return value === null ? null : bounded(value, field);
}

function optionList(value: unknown, field: string, options: readonly string[]): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !options.includes(item))
      || new Set(value).size !== value.length) {
    throw new BadRequestError(`${field} must be an array of unique printed options`);
  }
  return [...value];
}

function allowedKeys(fields: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw new BadRequestError(`unknown treatment field: ${field}.${key}`);
  }
}

function checklist(value: unknown, name: string, options: readonly string[], percentageOptions?: readonly string[]) {
  const field = `technique_checklists.${name}`;
  const input = object(value, field);
  allowedKeys(input, ['selected', 'other_text', ...(percentageOptions ? ['percentages'] : [])], field);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (key === 'selected') output.selected = optionList(entry, `${field}.selected`, options);
    else if (key === 'other_text') output.other_text = text(entry, `${field}.other_text`);
    else {
      const percentages = object(entry, `${field}.percentages`);
      allowedKeys(percentages, percentageOptions ?? [], `${field}.percentages`);
      output.percentages = Object.fromEntries(Object.entries(percentages).map(([option, cell]) =>
        [option, text(cell, `${field}.percentages.${option}`)]));
    }
  }
  return output;
}

function checklists(value: unknown): Record<string, unknown> {
  const input = object(value, 'technique_checklists');
  allowedKeys(input, Object.keys(CHECKLISTS), 'technique_checklists');
  return Object.fromEntries(Object.entries(input).map(([name, entry]) =>
    [name, checklist(entry, name, CHECKLISTS[name], PERCENTAGES[name])]));
}

function accessProcedures(value: unknown): Record<string, unknown> {
  const input = object(value, 'access_procedures');
  allowedKeys(input, ACCESS_ROWS, 'access_procedures');
  return Object.fromEntries(Object.entries(input).map(([row, entry]) => {
    const cells = object(entry, `access_procedures.${row}`);
    allowedKeys(cells, ACCESS_COLUMNS, `access_procedures.${row}`);
    return [row, Object.fromEntries(Object.entries(cells).map(([column, cell]) =>
      [column, text(cell, `access_procedures.${row}.${column}`)]))];
  }));
}

function obturationCut(value: unknown, field: string): Record<string, unknown> {
  const input = object(value, field);
  allowedKeys(input, ['option', 'apex_mm'], field);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (key === 'option') {
      if (entry !== null && !OBTURATION_CUTS.includes(entry as typeof OBTURATION_CUTS[number])) {
        throw new BadRequestError(`${field}.option must be canal_entry, apex_mm, or null`);
      }
      output.option = entry;
    } else output.apex_mm = text(entry, `${field}.apex_mm`);
  }
  return output;
}

function canalRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > MAX_CANAL_ROWS) {
    throw new BadRequestError(`canal_measurements must be an array of at most ${MAX_CANAL_ROWS} rows`);
  }
  return value.map((entry, index) => {
    const field = `canal_measurements[${index}]`;
    const row = object(entry, field);
    allowedKeys(row, [...CANAL_TEXT_COLUMNS, 'obturation_cut'], field);
    return Object.fromEntries(Object.entries(row).map(([column, cell]) => [column,
      column === 'obturation_cut' ? obturationCut(cell, `${field}.obturation_cut`) : text(cell, `${field}.${column}`)]));
  });
}

function treatedTeeth(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_TREATED_TEETH) {
    throw new BadRequestError(`treated_teeth must be an array of at most ${MAX_TREATED_TEETH} tooth texts`);
  }
  return value.map((tooth, index) => {
    if (typeof tooth !== 'string' || tooth.length === 0) throw new BadRequestError(`treated_teeth[${index}] must be non-empty text`);
    return bounded(tooth, `treated_teeth[${index}]`);
  });
}

function sessionCount(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new BadRequestError('session_count must be a non-negative integer, or null');
  }
  return value as number;
}

// Partial saves are valid; clinical completeness and unit meaning are left to the closing teacher.
export function validateTreatmentContent(value: unknown): TreatmentContent {
  const input = object(value, 'content');
  const output: TreatmentContent = {};
  for (const [key, entry] of Object.entries(input)) {
    if ((TEXT_SECTIONS as readonly string[]).includes(key)) output[key] = text(entry, key);
    else if (key === 'treated_teeth') output[key] = treatedTeeth(entry);
    else if (key === 'session_count') output[key] = sessionCount(entry);
    else if (key === 'access_procedures') output[key] = accessProcedures(entry);
    else if (key === 'technique_checklists') output[key] = checklists(entry);
    else if (key === 'canal_measurements') output[key] = canalRows(entry);
    else throw new BadRequestError(`unknown treatment content section: ${key}`);
  }
  return output;
}
