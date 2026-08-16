import { Router } from 'express';
import { RegisterUser } from '../../application/register-user.js';
import { LoginUser } from '../../application/login-user.js';
import { RequestPasswordReset } from '../../application/request-password-reset.js';
import { ResetPassword } from '../../application/reset-password.js';
import { OpenGuard } from '../../../shared/application/guard.js';

/**
 * Auth routes. Use cases receive injected ports; the guard is the policy
 * boundary in front of each endpoint. OpenGuard keeps registration open
 * until an admin-only guard replaces it at wiring time. Login and both
 * password-recovery endpoints are the unauthenticated entry points, so
 * they bypass the guard.
 */
export function createAuthRouter({
  repository,
  hasher,
  tokenService,
  resetTokenRepository,
  mailer,
  clientUrl,
  resetTokenTtl,
  guard = new OpenGuard(),
}) {
  const router = Router();
  const registerUser = new RegisterUser({ repository, hasher });
  const loginUser = new LoginUser({ repository, hasher, tokenService });
  const requestPasswordReset = new RequestPasswordReset({
    repository,
    resetTokenRepository,
    mailer,
    clientUrl,
    resetTokenTtl,
  });
  const resetPassword = new ResetPassword({ repository, resetTokenRepository, hasher });

  router.post('/register', async (req, res) => {
    await guard.authorize(req);
    const user = await registerUser.execute({
      username: req.body?.username,
      password: req.body?.password,
      email: req.body?.email,
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

  router.post('/forgot-password', async (req, res) => {
    const result = await requestPasswordReset.execute({
      username: req.body?.username,
    });
    res.status(200).json(result);
  });

  router.post('/reset-password', async (req, res) => {
    const result = await resetPassword.execute({
      token: req.body?.token,
      newPassword: req.body?.newPassword,
    });
    res.status(200).json(result);
  });

  return router;
}
