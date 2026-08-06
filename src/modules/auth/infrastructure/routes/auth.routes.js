import { Router } from 'express';
import { RegisterUser } from '../../application/register-user.js';
import { OpenGuard } from '../../../shared/application/guard.js';

/**
 * Auth routes. Use cases receive injected ports; the guard is the policy
 * boundary in front of each endpoint. OpenGuard keeps registration open
 * until an admin-only guard replaces it at wiring time.
 */
export function createAuthRouter({ repository, hasher, guard = new OpenGuard() }) {
  const router = Router();
  const registerUser = new RegisterUser({ repository, hasher });

  router.post('/register', async (req, res) => {
    await guard.authorize(req);
    const user = await registerUser.execute({
      username: req.body?.username,
      password: req.body?.password,
    });
    res.status(201).json(user.toJSON());
  });

  return router;
}
