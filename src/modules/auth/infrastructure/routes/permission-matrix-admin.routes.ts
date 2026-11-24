import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../../shared/domain/errors.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import type { RoleGrantRepository } from '../../application/active-role.ports.js';
import type { PermissionMatrixSnapshotReader } from '../../application/permission-matrix-snapshot.ports.js';

/** Read-only inspection of the permission catalog and assigned roles. */
export function createPermissionMatrixAdminRouter({ reader, roleGrantRepository, authenticate }: {
  reader: PermissionMatrixSnapshotReader;
  roleGrantRepository: RoleGrantRepository;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.get('/permission-matrix', authenticate, async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    if (auth?.role !== 'admin') throw new ForbiddenError('Admin role required');
    const userId = auth.userId ?? auth.sub;
    if (!userId || !await roleGrantRepository.isValidActiveRole(userId, 'admin')) {
      throw new UnauthorizedError('Invalid or missing token');
    }
    const snapshot = await reader.readSnapshot();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(snapshot);
  });
  return router;
}
