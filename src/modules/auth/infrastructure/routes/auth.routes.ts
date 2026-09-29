import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { RegisterUser } from '../../application/register-user.usecase.js';
import { LoginUser } from '../../application/login-user.usecase.js';
import { RequestPasswordReset } from '../../application/request-password-reset.usecase.js';
import { ResetPassword } from '../../application/reset-password.usecase.js';
import { GetCurrentUser } from '../../application/get-current-user.usecase.js';
import { OpenGuard } from '../../../shared/application/guard.js';
import type { UserRepositoryPort, PasswordHasherPort, TokenServicePort, ResetTokenRepositoryPort, MailerPort, PermissionMatrixReader } from '../../application/auth.ports.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';

export interface AuthRouterDeps {
  repository: UserRepositoryPort;
  hasher: PasswordHasherPort;
  tokenService: TokenServicePort;
  matrixReader: PermissionMatrixReader;
  resetTokenRepository: ResetTokenRepositoryPort;
  mailer: MailerPort;
  clientUrl: string;
  resetTokenTtl: number;
  guard?: Guard;
  /**
   * Optional Express middleware mounted in front of the register handler
   * only (e.g. `authenticate(tokenService, matrixReader)`), so register can
   * sit behind token verification while login and password recovery keep
   * working unauthenticated.
   */
  registerMiddleware?: RequestHandler;
  /**
   * Optional middleware mounted in front of `GET /me` (e.g.
   * `authenticate(tokenService, matrixReader)`). `/me` is only mounted when
   * BOTH `meMiddleware` and `meGuard` are provided.
   */
  meMiddleware?: RequestHandler;
  /**
   * Optional policy guard evaluated inside the `/me` handler after
   * `meMiddleware` (e.g. `new PermissionGuard('profile:read')`).
   */
  meGuard?: Guard;
  /**
   * Resolves the acting user id for `created_by` attribution on register
   * (default: the verified token `sub`/`userId` from `req.auth` — AUD-003).
   * Login and password recovery never use it.
   */
  getActor?: (req: Request) => Promise<string | null>;
}

/**
 * Auth routes. Use cases receive injected ports; the guard is the policy
 * boundary in front of each endpoint. OpenGuard keeps registration open
 * until an admin-only guard replaces it at wiring time. Login and both
 * password-recovery endpoints are the unauthenticated entry points, so they
 * bypass the guard. `getActor` resolves the acting admin id for the register
 * `created_by` audit column from the verified token subject.
 */
export function createAuthRouter({
  repository,
  hasher,
  tokenService,
  matrixReader,
  resetTokenRepository,
  mailer,
  clientUrl,
  resetTokenTtl,
  guard = new OpenGuard(),
  registerMiddleware,
  meMiddleware,
  meGuard,
  getActor = defaultGetActor,
}: AuthRouterDeps): Router {
  const router = Router();
  const registerUser = new RegisterUser({ repository, hasher });
  const loginUser = new LoginUser({ repository, hasher, tokenService, matrixReader });
  const requestPasswordReset = new RequestPasswordReset({
    repository,
    resetTokenRepository,
    mailer,
    clientUrl,
    resetTokenTtl,
  });
  const resetPassword = new ResetPassword({ repository, resetTokenRepository, hasher });
  const getCurrentUser = new GetCurrentUser({ repository });

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

  // GET /me stays unmounted until wiring provides BOTH the auth middleware
  // and the policy guard. The payload is built from a fresh DB read by the
  // verified subject (never from JWT claims) and carries exactly
  // { username, email, role } (PR-001).
  if (meMiddleware && meGuard) {
    router.get('/me', meMiddleware, async (req: Request, res: Response) => {
      await meGuard.authorize(req);
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.auth?.userId ?? authReq.auth?.sub;
      const currentUser = await getCurrentUser.execute({ userId });
      res.status(200).json(currentUser);
    });
  }

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
