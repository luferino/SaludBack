import { BadRequestError } from '../../shared/domain/errors.js';

const MAX_SIGNER_NAME_CHARACTERS = 200;
// Same rule as procedure.ts: only unpaired surrogates match \p{Cs} in Unicode mode.
const LONE_SURROGATE = /\p{Cs}/u;

// Parent signer name is stored exactly as sent; only the length, blank, NUL and surrogate rules apply.
export function consentSignerName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || [...value].length > MAX_SIGNER_NAME_CHARACTERS
      || value.includes('\u0000') || LONE_SURROGATE.test(value)) {
    throw new BadRequestError('signer_name must be non-empty text of at most 200 characters without NUL');
  }
  return value;
}

// Same format as the patient documento (create-patient: 4-8 digits); ASCII digits only.
export function consentSignerDocument(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4,8}$/.test(value)) {
    throw new BadRequestError('signer_document must be 4-8 digits');
  }
  return value;
}
