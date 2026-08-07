import { Router } from 'express';
import { RegisterUser } from '../../application/register-user.js';
import { LoginUser } from '../../application/login-user.js';
import { OpenGuard } from '../../../shared/application/guard.js';

/**
 * Auth routes. Use cases receive injected ports; the guard is the policy
 * boundary in front of each endpoint. OpenGuard keeps registration open
 * until an admin-only guard replaces it at wiring time. Login is the
 * unauthenticated entry point, so it bypasses the guard.
 */
export function createAuthRouter({ repository, hasher, tokenService, guard = new OpenGuard() }) {
  const router = Router();
  const registerUser = new RegisterUser({ repository, hasher });
  const loginUser = new LoginUser({ repository, hasher, tokenService });

  router.post('/register', async (req, res) => {
    await guard.authorize(req);
    const user = await registerUser.execute({
      username: req.body?.username,
      password: req.body?.password,
    });
    res.status(201).json(user.toJSON());
  });

  router.post('/login', async (req, res) => {
    const result = await loginUser.execute({
      username: req.body?.username,
      password: req.body?.password,
    });
    res.status(200).json(result);
  });

  return router;
}
