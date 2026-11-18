import { BadRequestError } from '../../shared/domain/errors.js';

const MAX_DESCRIPTION_CHARACTERS = 1000;
// In Unicode mode only unpaired surrogates match \p{Cs}; valid astral characters do not.
const LONE_SURROGATE = /\p{Cs}/u;

// Procedure date follows the UTC convention of create-patient: real calendar date and not in the future.
export function procedureDate(value: unknown): string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) throw new BadRequestError('procedure_date must be a valid YYYY-MM-DD date');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isRealDate) throw new BadRequestError('procedure_date must be a valid YYYY-MM-DD date');

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > todayUtc) throw new BadRequestError('procedure_date cannot be in the future');

  return value as string;
}

// Free text is stored exactly as sent; only the length, blank and NUL rules apply.
export function procedureDescription(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || [...value].length > MAX_DESCRIPTION_CHARACTERS
      || value.includes('\u0000') || LONE_SURROGATE.test(value)) {
    throw new BadRequestError('description must be non-empty text of at most 1000 characters without NUL');
  }
  return value;
}
