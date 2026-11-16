import { BadRequestError } from '../../shared/domain/errors.js';
import { object } from './content.js';

const sections: Record<string, readonly string[]> = {
  asepsis: ['extraoral', 'intraoral'],
  anesthesia: ['technique', 'drug', 'dose'],
  extraction: ['teeth', 'technique', 'suture'],
  prescription: ['medications', 'commercial_name', 'route', 'dose', 'frequency', 'duration'],
};
export type OperativeContent = Record<string, string | null | Record<string, string | null>>;

function text(value: unknown, field: string): string | null {
  if (value !== null && (typeof value !== 'string' || [...value].length > 4000 || value.includes('\u0000'))) {
    throw new BadRequestError(`${field} must be text of at most 4000 characters without NUL, or null`);
  }
  return value as string | null;
}

// Incomplete saves are valid; clinical completeness is reviewed by the closing teacher.
export function validateOperativeContent(value: unknown): OperativeContent {
  const input = object(value, 'content');
  const output: OperativeContent = {};
  for (const [key, entry] of Object.entries(input)) {
    if (['narrative', 'postoperative_instructions', 'operative_incident'].includes(key)) {
      output[key] = text(entry, key);
    } else if (Object.hasOwn(sections, key)) {
      const section: Record<string, string | null> = {};
      for (const [field, answer] of Object.entries(object(entry, key))) {
        if (!sections[key].includes(field)) throw new BadRequestError(`unknown operative field: ${key}.${field}`);
        section[field] = text(answer, `${key}.${field}`);
      }
      output[key] = section;
    } else throw new BadRequestError(`unknown operative section: ${key}`);
  }
  return output;
}
