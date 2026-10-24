import type { Express } from 'express';
import type { AppDependencies } from '../create-dependencies.js';
import { createAuthRouter } from '../../modules/auth/infrastructure/routes/auth.routes.js';
import { authenticate } from '../../modules/auth/infrastructure/middleware/authenticate.js';
import { PermissionGuard } from '../../modules/shared/application/guard.js';

export function mountAuthRoutes(app: Express, dependencies: AppDependencies['auth']): void {
  const { repository, resetTokenRepository, mailer, hasher, tokenService, matrixReader, clientUrl, resetTokenTtl } = dependencies;

  app.use(
    '/auth',
    createAuthRouter({
      repository,
      hasher,
      tokenService,
      matrixReader,
      resetTokenRepository,
      mailer,
      clientUrl,
      resetTokenTtl,
      // Permission-only registration: authenticate FIRST (populates
      // req.auth), PermissionGuard('users:write') evaluates inside the
      // register handler (PG-003). Login and password recovery bypass both
      // (they are the entry points). GET /me: authenticate +
      // PermissionGuard('profile:read'), then a fresh DB read by the
      // verified subject (PR-001).
      guard: new PermissionGuard('users:write'),
      registerMiddleware: authenticate(tokenService, matrixReader),
      meMiddleware: authenticate(tokenService, matrixReader),
      meGuard: new PermissionGuard('profile:read'),
    }),
  );
}
