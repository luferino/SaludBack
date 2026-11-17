import { BadRequestError } from '../../shared/domain/errors.js';
import { object } from './content.js';

// Fixed rubric from the paper form: ten items, with Bioseguridad split into three 1-point sub-items.
export const PRACTICAL_RUBRIC = [
  { key: 'hand_washing', max: 1 },
  { key: 'barrier_elements', max: 1 },
  { key: 'waste_disposal', max: 1 },
  { key: 'clinical_table_setup', max: 2 },
  { key: 'asepsis', max: 1 },
  { key: 'anamnesis_questionnaire', max: 3 },
  { key: 'anesthetic_technique', max: 2 },
  { key: 'sindesmotomy_elevators', max: 2 },
  { key: 'surgical_procedure', max: 3 },
  { key: 'curettage_suture', max: 2 },
  { key: 'record_and_equipment', max: 1 },
  { key: 'relationship', max: 1 },
] as const;

export type PracticalItemKey = (typeof PRACTICAL_RUBRIC)[number]['key'];
export type PracticalItems = Record<PracticalItemKey, number>;
export type PracticalOutcome = 'approved' | 'annulled';

export const PRACTICAL_PASSING_TOTAL = 15;

// Every key is required; unknown keys, non-integers and out-of-range scores never reach storage.
export function validatePracticalItems(value: unknown): PracticalItems {
  const input = object(value, 'items');
  const known = new Set<string>(PRACTICAL_RUBRIC.map(item => item.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new BadRequestError(`unknown practical item: ${key}`);
  }
  const output = {} as PracticalItems;
  for (const { key, max } of PRACTICAL_RUBRIC) {
    if (!Object.hasOwn(input, key)) throw new BadRequestError(`missing practical item: ${key}`);
    const score = input[key];
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > max) {
      throw new BadRequestError(`${key} must be an integer from 0 to ${max}`);
    }
    output[key] = score;
  }
  return output;
}

export function practicalTotal(items: PracticalItems): number {
  return PRACTICAL_RUBRIC.reduce((sum, { key }) => sum + items[key], 0);
}

export function practicalOutcome(total: number): PracticalOutcome {
  return total >= PRACTICAL_PASSING_TOTAL ? 'approved' : 'annulled';
}

export function validateCorrectionReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || [...value].length > 4000 || value.includes('\u0000')) {
    throw new BadRequestError('reason must be non-empty text of at most 4000 characters without NUL');
  }
  return value;
}
