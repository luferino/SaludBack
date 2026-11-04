import { BadRequestError } from '../../shared/domain/errors.js';

export interface EvolutionContent {
  session_date?: string | null;
  current_status?: string | null;
  objectives?: string | null;
  planned_treatment?: string | null;
}

const fields = ['session_date', 'current_status', 'objectives', 'planned_treatment'] as const;

export function validateEvolutionSubmission(value: unknown): EvolutionContent {
  const content = validateEvolutionContent(value);
  if (!content.session_date || !content.current_status?.trim() || !content.objectives?.trim() || !content.planned_treatment?.trim()) {
    throw new BadRequestError('all evolution fields are required for submission');
  }
  return content;
}

export function validateEvolutionContent(value: unknown): EvolutionContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BadRequestError('content must be an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !fields.includes(key as typeof fields[number]))) throw new BadRequestError('content contains an unknown field');
  const output: EvolutionContent = {};
  for (const field of fields) {
    const item = input[field];
    if (item === undefined) continue;
    if (item !== null && typeof item !== 'string') throw new BadRequestError(`${field} must be a string or null`);
    if (field === 'session_date' && item !== null && !isCivilDate(item as string)) throw new BadRequestError('session_date must be a valid YYYY-MM-DD date');
    output[field] = item as never;
  }
  return output;
}

function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
