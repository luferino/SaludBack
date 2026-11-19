import { BadRequestError } from '../../shared/domain/errors.js';

/**
 * Personal data fields shared by the patient record: marital status and
 * medical insurance. The API tokens are a closed set; `null` means not
 * recorded, while `none` (insurance) means declared without insurance.
 */
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'civil_union'] as const;
export const MEDICAL_INSURANCES = ['ips', 'police_health', 'military_health', 'none'] as const;

export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export type MedicalInsurance = (typeof MEDICAL_INSURANCES)[number];

export const PERSONAL_DATA_FIELDS = ['marital_status', 'medical_insurance'] as const;

export interface PersonalDataPatch {
  maritalStatus?: MaritalStatus | null;
  medicalInsurance?: MedicalInsurance | null;
}

/** Validates a marital status token. `null` clears the value; anything else must be a listed token. */
export function maritalStatus(value: unknown): MaritalStatus | null {
  if (value === null) return null;
  if (typeof value === 'string' && (MARITAL_STATUSES as readonly string[]).includes(value)) return value as MaritalStatus;
  throw new BadRequestError(`marital_status must be ${MARITAL_STATUSES.join(', ')} or null`);
}

/** Validates a medical insurance token. `null` means not recorded; `none` means declared without insurance. */
export function medicalInsurance(value: unknown): MedicalInsurance | null {
  if (value === null) return null;
  if (typeof value === 'string' && (MEDICAL_INSURANCES as readonly string[]).includes(value)) return value as MedicalInsurance;
  throw new BadRequestError(`medical_insurance must be ${MEDICAL_INSURANCES.join(', ')} or null`);
}

/**
 * Validates the personal-data keys present in `body` and returns them. A key that is absent is left out of
 * the result, so the caller can tell "omitted" (keep the stored value) from `null` (clear it).
 */
export function personalDataFields(body: Record<string, unknown>): PersonalDataPatch {
  const patch: PersonalDataPatch = {};
  if (body.marital_status !== undefined) patch.maritalStatus = maritalStatus(body.marital_status);
  if (body.medical_insurance !== undefined) patch.medicalInsurance = medicalInsurance(body.medical_insurance);
  return patch;
}

/**
 * Builds the patch for the dedicated personal-data PATCH endpoints (S7). Only the keys the caller sent are
 * returned, so an omitted field keeps its stored value and `null` clears it.
 */
export function personalDataPatch(body: unknown): PersonalDataPatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('body must be an object');
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some(key => !(PERSONAL_DATA_FIELDS as readonly string[]).includes(key))) {
    throw new BadRequestError('allowed fields: marital_status, medical_insurance');
  }
  if (keys.length === 0) {
    throw new BadRequestError('at least one of marital_status or medical_insurance is required');
  }
  return personalDataFields(record);
}
