import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../shared/application/authenticated-request.js';
import { ForbiddenError } from '../../shared/domain/errors.js';
import type { LiveRoleReader } from './active-role.ports.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An individual capability configured by operators, never by the management panel. */
export function createReceptionPilotAdminGuard(rawIds: string | undefined, membership: LiveRoleReader) {
  const ids = new Set(rawIds?.trim() ? rawIds.split(',').map(id => id.trim().toLowerCase()) : []);
  if ([...ids].some(id => !UUID.test(id))) {
    throw new Error('RECEPTION_PILOT_ADMIN_IDS must contain comma-separated UUIDs');
  }

  async function allows(request: Request): Promise<boolean> {
    const actor = (request as AuthenticatedRequest).auth;
    const userId = actor?.userId ?? actor?.sub;
    return actor?.role === 'admin' && typeof userId === 'string' && ids.has(userId.toLowerCase())
      && await membership.isValidActiveRole(userId, 'admin');
  }

  return {
    allows,
    async authorize(request: Request): Promise<void> {
      if (!await allows(request)) throw new ForbiddenError('Reception pilot administration permission required');
    },
  };
}
