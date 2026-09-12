import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { RegisterUser } from '../../application/register-user.usecase.js';
import { LoginUser } from '../../application/login-user.usecase.js';
import { RequestPasswordReset } from '../../application/request-password-reset.usecase.js';
import { ResetPassword } from '../../application/reset-password.usecase.js';
import { OpenGuard } from '../../../shared/application/guard.js';
import type { UserRepositoryPort, PasswordHasherPort, TokenServicePort, ResetTokenRepositoryPort, MailerPort } from '../../application/auth.ports.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { AuthenticatedRequest } from '../middleware/authenticate.js';

export interface AuthRouterDeps {
  repository: UserRepositoryPort;
  hasher: PasswordHasherPort;
  tokenService: TokenServicePort;
  resetTokenRepository: ResetTokenRepositoryPort;
  mailer: MailerPort;
  clientUrl: string;
  resetTokenTtl: number;
  guard?: Guard;
  /**
   * Optional Express middleware mounted in front of the register handler
   * only (e.g. `authenticate(tokenService)`), so register can sit behind
   * token verification while login and the password-recovery endpoints
   * stay unauthenticated. Runs BEFORE the guard inside the handler.
   */
  registerMiddleware?: RequestHandler;
  /**
   * Resolves the acting user id for `created_by` attribution on register
   * (default: the verified token `sub`/`userId` from `req.auth` —
   * AUD-003). Login, forgot-password and reset-password never use it.
   */
  getActor?: (req: Request) => Promise<string | null>;
}

/**
 * Auth routes. Use cases receive injected ports; the guard is the policy
 * boundary in front of each endpoint. OpenGuard keeps registration open
 * until an admin-only guard replaces it at wiring time. Login and both
 * password-recovery endpoints are the unauthenticated entry points, so
 * they bypass the guard. `getActor` resolves the acting admin id for the
 * register `created_by` audit column from the verified token subject.
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
  registerMiddleware,
  getActor = defaultGetActor,
}: AuthRouterDeps): Router {
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

  const registerPreHandlers = registerMiddleware ? [registerMiddleware] : [];
  router.post('/register', ...registerPreHandlers, async (req: Request, res: Response) => {
    await guard.authorize(req);
    const actor = await getActor(req);
    const user = await registerUser.execute({
      username: req.body?.username,
      password: req.body?.password,
      email: req.body?.email,
      createdBy: actor,
    });
    res.status(201).json(user.toJSON());
  });

  router.post('/login', async (req: Request, res: Response) => {
    const result = await loginUser.execute({
      username: req.body?.username,
      password: req.body?.password,
    });
    res.status(200).json(result);
  });

  router.post('/forgot-password', async (req: Request, res: Response) => {
    const result = await requestPasswordReset.execute({
      username: req.body?.username,
    });
    res.status(200).json(result);
  });

  router.post('/reset-password', async (req: Request, res: Response) => {
    const result = await resetPassword.execute({
      token: req.body?.token,
      newPassword: req.body?.newPassword,
    });
    res.status(200).json(result);
  });

  return router;
}

/**
 * Default actor hook: reads the verified token subject from `req.auth`,
 * preferring the `userId` alias and falling back to `sub` (both are set
 * by `authenticate` when the token carries a `sub` claim — AUTH-002).
 * Resolves to null when `req.auth` is unset (open route) or lacks a
 * subject; a guard or token middleware can set the seam without changing
 * the contract (AUD-003).
 */
export async function defaultGetActor(req: Request): Promise<string | null> {
  const authReq = req as AuthenticatedRequest;
  return authReq.auth?.userId ?? authReq.auth?.sub ?? null;
}
