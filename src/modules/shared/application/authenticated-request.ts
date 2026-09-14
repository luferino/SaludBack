import type { Request } from 'express';

/**
 * Canonical shape of the verified-token context the `authenticate` middleware
 * attaches to requests (`req.auth = { role, permissions, sub, userId }`).
 * The single source of truth for the type; both the middleware and the
 * guards import it from the shared application layer.
 */
export interface AuthenticatedRequest extends Request {
  auth?: {
    role: string;
    permissions: string[];
    sub?: string;
    userId?: string;
  };
}