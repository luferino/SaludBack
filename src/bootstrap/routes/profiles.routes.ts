import type { Express } from 'express';
import type { AppDependencies } from '../create-dependencies.js';
import { createPatientRouter } from '../../modules/patients/infrastructure/routes/patient.routes.js';
import { createStudentRouter } from '../../modules/students/infrastructure/routes/student.routes.js';
import { createTeacherRouter } from '../../modules/teachers/infrastructure/routes/teacher.routes.js';
import { authenticate } from '../../modules/auth/infrastructure/middleware/authenticate.js';
import { PermissionGuard } from '../../modules/shared/application/guard.js';

export function mountProfileRoutes(app: Express, dependencies: AppDependencies['profiles']): void {
  const { patientRepository, studentRepository, teacherRepository, userRepository, hasher, unitOfWork, tokenService, matrixReader } = dependencies;

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
      userRepository,
      hasher,
      unitOfWork,
      guard: new PermissionGuard('students:write'),
      listGuard: new PermissionGuard('students:read'),
    }),
  );
  app.use(
    '/teachers',
    authenticate(tokenService, matrixReader),
    createTeacherRouter({
      repository: teacherRepository,
      userRepository,
      hasher,
      unitOfWork,
      guard: new PermissionGuard('teachers:write'),
      listGuard: new PermissionGuard('teachers:read'),
    }),
  );
}
