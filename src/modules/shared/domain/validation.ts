import { BadRequestError } from './errors.js';

/**
 * Validate that a password meets minimum strength requirements.
 * Throws BadRequestError if the password is missing, too short,
 * or lacks both letters and digits.
 */
export function validatePassword(password: string): void {
  if (!password) {
    throw new BadRequestError('password is required');
  }
  if (password.length < 10) {
    throw new BadRequestError('password must be at least 10 characters');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new BadRequestError('password must contain at least one letter and one number');
  }
}

/**
 * Normalize a username: trims whitespace, uppercases, and validates
 * that it contains only letters and numbers (A-Z0-9).
 * Throws BadRequestError if the username is empty or contains invalid characters.
 * Returns the normalized (uppercased, trimmed) username.
 */
export function normalizeUsername(username: string): string {
  const trimmed = (username ?? '').trim();
  if (trimmed === '') {
    throw new BadRequestError('username is required');
  }
  const upper = trimmed.toUpperCase();
  if (!/^[A-Z0-9]+$/.test(upper)) {
    throw new BadRequestError('username may only contain letters and numbers');
  }
  return upper;
}

/**
 * Normalize an email for validation, lookup, and storage: trims
 * surrounding whitespace, treats missing/empty/whitespace-only values as
 * absent (`null`), and validates present values against the shared email
 * pattern.
 * Throws BadRequestError if the trimmed value is malformed.
 * Returns the trimmed email, or `null` when absent.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    throw new BadRequestError('email must be a valid address');
  }
  return trimmed;
}
