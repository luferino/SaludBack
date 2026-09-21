import express from 'express';
import type { Pool } from 'pg';
import config from './config.js';
import { createAuthRouter } from './modules/auth/infrastructure/routes/auth.routes.js';
import { PgUserRepository } from './modules/auth/infrastructure/repositories/pg-user.repository.js';
import { PgResetTokenRepository } from './modules/auth/infrastructure/repositories/pg-reset-token.repository.js';
import { PgPermissionMatrixRepository } from './modules/auth/infrastructure/repositories/pg-permission-matrix.repository.js';
import { BcryptHasher } from './modules/auth/infrastructure/services/bcrypt-hasher.service.js';
import { JwtTokenService } from './modules/auth/infrastructure/services/jwt-token.service.js';
import { ConsoleMailer } from './modules/auth/infrastructure/services/console-mailer.service.js';
import { createPatientRouter } from './modules/patients/infrastructure/routes/patient.routes.js';
import { PgPatientRepository } from './modules/patients/infrastructure/repositories/pg-patient.repository.js';
import { createStudentRouter } from './modules/students/infrastructure/routes/student.routes.js';
import { PgStudentRepository } from './modules/students/infrastructure/repositories/pg-student.repository.js';
import { createTeacherRouter } from './modules/teachers/infrastructure/routes/teacher.routes.js';
import { PgTeacherRepository } from './modules/teachers/infrastructure/repositories/pg-teacher.repository.js';
import { PgUnitOfWork } from './modules/shared/infrastructure/pg-unit-of-work.js';
import { PermissionGuard } from './modules/shared/application/guard.js';
import { authenticate } from './modules/auth/infrastructure/middleware/authenticate.js';
import { errorHandler } from './middleware/error-handler.js';

/**
 * Production app factory (PR 4 wiring). Builds the shared pool-backed
 * repositories, hasher, token service and unit of work once and mounts every
 * router on one Express app: `/auth` (register/login/me/password recovery),
 * `/patients`, `/students` and `/teachers`. Every protected mount enforces
 * the permission mapped in PG-003 via `PermissionGuard` after `authenticate`
 * populates `req.auth`: register -> `users:write`, students/teachers/patients
 * -> their own write permission, `GET /auth/me` -> `profile:read`. The admin
 * role owns every implemented permission through its seeded
 * `role_permissions` grants (PG-001), so admin behavior is unchanged. Login
 * and password recovery stay unauthenticated. The verified token `sub`
 * flows into `created_by` through the default actor hook once `req.auth` is
 * set (AUD-003). One shared `PgPermissionMatrixRepository` instance feeds
 * `authenticate` on every protected mount (DB wins per request).
 */
export function createApp(pool: Pool): express.Express {
  const repository = new PgUserRepository(pool);
  const resetTokenRepository = new PgResetTokenRepository(pool, config.resetTokenMaxOutstanding);
  const mailer = new ConsoleMailer();
  const patientRepository = new PgPatientRepository(pool);
  const studentRepository = new PgStudentRepository(pool);
  const teacherRepository = new PgTeacherRepository(pool);
  const unitOfWork = new PgUnitOfWork(pool);
  const hasher = new BcryptHasher(config.bcryptCost);
  const tokenService = new JwtTokenService({
    secret: config.jwtSecret,
    secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets,
    expiresIn: config.jwtExpiresIn,
  });
  const matrixReader = new PgPermissionMatrixRepository(pool);

  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.send('Hello, World!');
  });

  app.use(
    '/auth',
    createAuthRouter({
      repository,
      hasher,
      tokenService,
      matrixReader,
      resetTokenRepository,
      mailer,
      clientUrl: config.clientUrl,
      resetTokenTtl: config.resetTokenTtl,
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

  // Alta endpoints require their mapped write permission: authenticate runs
  // BEFORE the router so req.auth exists when PermissionGuard evaluates and
  // when getActor resolves created_by from the token sub (PG-003, STU-005,
  // TEA-004, PAT-005).
  app.use(
    '/patients',
    authenticate(tokenService, matrixReader),
    createPatientRouter({ repository: patientRepository, guard: new PermissionGuard('patients:write') }),
  );
  app.use(
    '/students',
    authenticate(tokenService, matrixReader),
    createStudentRouter({
      repository: studentRepository,
      userRepository: repository,
      hasher,
      unitOfWork,
      guard: new PermissionGuard('students:write'),
    }),
  );
  app.use(
    '/teachers',
    authenticate(tokenService, matrixReader),
    createTeacherRouter({
      repository: teacherRepository,
      userRepository: repository,
      hasher,
      unitOfWork,
      guard: new PermissionGuard('teachers:write'),
    }),
  );

  app.use(errorHandler);

  return app;
}