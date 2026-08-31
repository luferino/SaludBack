import express from 'express';
import type { Pool } from 'pg';
import config from './config.js';
import { createAuthRouter } from './modules/auth/infrastructure/routes/auth.routes.js';
import { PgUserRepository } from './modules/auth/infrastructure/repositories/pg-user.repository.js';
import { PgResetTokenRepository } from './modules/auth/infrastructure/repositories/pg-reset-token.repository.js';
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
import { errorHandler } from './middleware/error-handler.js';

/**
 * Production app factory (PR 4 wiring). Builds the shared pool-backed
 * repositories, hasher, token service and unit of work once and mounts every
 * router on one Express app: `/auth` (register/login/password recovery),
 * `/patients`, `/students` and `/teachers` (open alta en uno; guards and
 * authenticate middleware attach later at the route boundary — PAT-005,
 * STU-005, TEA-004). `index.ts` consumes this factory so the exact production
 * wiring is testable end-to-end.
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
    expiresIn: config.jwtExpiresIn,
  });

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
      resetTokenRepository,
      mailer,
      clientUrl: config.clientUrl,
      resetTokenTtl: config.resetTokenTtl,
    }),
  );

  // Open routes: no guard or actor hook passed, so alta is public and
  // created_by stays null until a guard and token wiring land (PAT-005,
  // STU-005, TEA-004 default open).
  app.use('/patients', createPatientRouter({ repository: patientRepository }));
  app.use(
    '/students',
    createStudentRouter({
      repository: studentRepository,
      userRepository: repository,
      hasher,
      unitOfWork,
    }),
  );
  app.use(
    '/teachers',
    createTeacherRouter({
      repository: teacherRepository,
      userRepository: repository,
      hasher,
      unitOfWork,
    }),
  );

  app.use(errorHandler);

  return app;
}