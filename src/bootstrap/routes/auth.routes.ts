import type { Express } from 'express';
import type { AppDependencies } from '../create-dependencies.js';
import { createAuthRouter } from '../../modules/auth/infrastructure/routes/auth.routes.js';
import { createActiveRoleAdminRouter } from '../../modules/auth/infrastructure/routes/active-role.routes.js';
import { authenticate } from '../../modules/auth/infrastructure/middleware/authenticate.js';
import { PermissionGuard } from '../../modules/shared/application/guard.js';
import { createReceptionRouter } from '../../modules/reception/infrastructure/routes/reception.routes.js';
import { createReceptionPatientRouter } from '../../modules/reception/infrastructure/routes/reception-patient.routes.js';
import { createReceptionAvailabilityRouter } from '../../modules/reception/infrastructure/routes/reception-availability.routes.js';

export function mountAuthRoutes(app: Express, dependencies: AppDependencies['auth']): void {
  const { repository, resetTokenRepository, mailer, hasher, tokenService, matrixReader, roleGrantRepository, clientUrl, resetTokenTtl, receptionRepository, receptionPatientRepository, receptionAvailabilityRepository } = dependencies;

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

  const receptionMiddleware = authenticate(tokenService, matrixReader);
  app.use('/auth', createActiveRoleAdminRouter({ repository: roleGrantRepository, authenticate: receptionMiddleware }));
  app.use('/auth', createReceptionRouter({ repository: receptionRepository, hasher, surface: 'admin', authenticate: receptionMiddleware }));
  app.use('/reception', createReceptionRouter({ repository: receptionRepository, hasher, surface: 'self', authenticate: receptionMiddleware }));
  app.use('/reception/patients', createReceptionPatientRouter({ repository: receptionPatientRepository, authenticate: receptionMiddleware }));
  app.use('/reception/availability', createReceptionAvailabilityRouter({ repository: receptionAvailabilityRepository, authenticate: receptionMiddleware }));
}
