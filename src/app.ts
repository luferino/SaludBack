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
import { createSubjectRouter } from './modules/subjects/infrastructure/routes/subject.routes.js';
import { PgSubjectRepository } from './modules/subjects/infrastructure/repositories/pg-subject.repository.js';
import { createGroupRouter } from './modules/groups/infrastructure/routes/group.routes.js';
import { PgGroupRepository } from './modules/groups/infrastructure/repositories/pg-group.repository.js';
import { createSubjectGroupRouter } from './modules/subject-groups/infrastructure/routes/subject-group.routes.js';
import { PgSubjectGroupRepository } from './modules/subject-groups/infrastructure/repositories/pg-subject-group.repository.js';
import { createTeacherHabilitationRouter } from './modules/teacher-habilitations/infrastructure/routes/teacher-habilitation.routes.js';
import { PgTeacherHabilitationRepository } from './modules/teacher-habilitations/infrastructure/repositories/pg-teacher-habilitation.repository.js';
import { createStudentHabilitationRouter } from './modules/student-habilitations/infrastructure/routes/student-habilitation.routes.js';
import { PgStudentHabilitationRepository } from './modules/student-habilitations/infrastructure/repositories/pg-student-habilitation.repository.js';
import { createPatientAssignmentRouter, PgPatientAssignmentRepository } from './modules/patient-assignments/index.js';
import { PgUnitOfWork } from './modules/shared/infrastructure/pg-unit-of-work.js';
import { PermissionGuard } from './modules/shared/application/guard.js';
import { authenticate } from './modules/auth/infrastructure/middleware/authenticate.js';
import { errorHandler } from './middleware/error-handler.js';

/**
 * Production app factory (PR 4 wiring). Builds the shared pool-backed
 * repositories, hasher, token service and unit of work once and mounts every
 * router on one Express app: `/auth` (register/login/me/password recovery),
 * `/patients`, `/students`, `/teachers`, `/subjects`, `/groups` and
 * `/subject-groups`. Every protected mount
 * enforces the permission mapped in PG-003 via `PermissionGuard` after
 * `authenticate` populates `req.auth`: register -> `users:write`,
 * students/teachers/patients -> their own write permission, `GET /auth/me` ->
 * `profile:read`, subject, group and subject-group creation/listing -> independent write/read
 * permissions. The admin role owns every implemented permission through its seeded
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
  const subjectRepository = new PgSubjectRepository(pool);
  const groupRepository = new PgGroupRepository(pool);
  const subjectGroupRepository = new PgSubjectGroupRepository(pool);
  const teacherHabilitationRepository = new PgTeacherHabilitationRepository(pool);
  const unitOfWork = new PgUnitOfWork(pool);
  const studentHabilitationRepository = new PgStudentHabilitationRepository(unitOfWork);
  const patientAssignmentRepository = new PgPatientAssignmentRepository(unitOfWork, pool);
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

  app.use(
    '/subjects',
    authenticate(tokenService, matrixReader),
    createSubjectRouter({
      repository: subjectRepository,
      createGuard: new PermissionGuard('subjects:write'),
      listGuard: new PermissionGuard('subjects:read'),
    }),
  );

  app.use(
    '/groups',
    authenticate(tokenService, matrixReader),
    createGroupRouter({
      repository: groupRepository,
      createGuard: new PermissionGuard('groups:write'),
      listGuard: new PermissionGuard('groups:read'),
    }),
  );

  app.use(
    '/subject-groups',
    authenticate(tokenService, matrixReader),
    createSubjectGroupRouter({
      repository: subjectGroupRepository,
      createGuard: new PermissionGuard('subject-groups:write'),
      listGuard: new PermissionGuard('subject-groups:read'),
    }),
  );

  app.use(
    '/student-habilitations',
    authenticate(tokenService, matrixReader),
    createStudentHabilitationRouter({ repository: studentHabilitationRepository, guard: new PermissionGuard('student-habilitations:write') }),
  );

  app.use(
    '/patient-assignments',
    authenticate(tokenService, matrixReader),
    createPatientAssignmentRouter({ repository: patientAssignmentRepository }),
  );

  // Teacher habilitation activation and period-specific revocation are audited
  // separately; neither changes student periods, assignments, or clinical access.
  app.use(
    '/teacher-habilitations',
    authenticate(tokenService, matrixReader),
    createTeacherHabilitationRouter({
      repository: teacherHabilitationRepository,
      guard: new PermissionGuard('teacher-habilitations:write'),
      revokeGuard: new PermissionGuard('teacher-habilitations:revoke'),
    }),
  );

  app.use(errorHandler);

  return app;
}