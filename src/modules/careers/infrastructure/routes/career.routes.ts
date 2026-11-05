import { Router } from 'express';
import type { Request, Response } from 'express';
import { ListCareers } from '../../application/list-careers.usecase.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { CareerRepositoryPort } from '../../application/career.ports.js';

export function createCareerRouter({
  repository,
  listGuard = new PermissionGuard('careers:read'),
}: {
  repository: CareerRepositoryPort;
  listGuard?: Guard;
}): Router {
  const router = Router();
  const listCareers = new ListCareers({ repository });

  router.get('/', async (req: Request, res: Response) => {
    await listGuard.authorize(req);
    const result = await listCareers.execute();
    res.status(200).json({
      items: result.items.map((career) => career.toJSON()),
    });
  });

  return router;
}
