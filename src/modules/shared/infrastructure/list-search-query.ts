import type { Request } from 'express';
import { BadRequestError } from '../domain/errors.js';

/** Parse raw pairs so Express query-parser settings cannot hide duplicates. */
export function listSearchQuery(req: Request, defaultLimit: number, extraKeys: string[] = []): { q?: string; limit: number; offset: number } {
  const start = req.originalUrl.indexOf('?');
  const query = new URLSearchParams(start === -1 ? '' : req.originalUrl.slice(start + 1));
  const allowed = new Set(['q', 'limit', 'offset', ...extraKeys]);
  for (const key of query.keys()) {
    if (!allowed.has(key)) throw new BadRequestError(`unknown query parameter: ${key}`);
    if (query.getAll(key).length !== 1) throw new BadRequestError(`query parameter must not be repeated: ${key}`);
  }
  const q = query.get('q')?.trim() || undefined;
  if (q && q.length > 100) throw new BadRequestError('q must be at most 100 characters');
  const page = (name: 'limit' | 'offset', fallback: number, minimum: number, maximum: number): number => {
    const raw = query.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new BadRequestError(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return { q, limit: page('limit', defaultLimit, 1, 100), offset: page('offset', 0, 0, 10000) };
}
