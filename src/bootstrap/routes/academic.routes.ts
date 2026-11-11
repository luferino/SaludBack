import type { Express } from 'express';
import type { AppDependencies } from '../create-dependencies.js';
import { createOralSurgerySubjectRouter } from '../../modules/oral-surgery-subjects/index.js';
import { createCareerRouter } from '../../modules/careers/infrastructure/routes/career.routes.js';
import { createSubjectRouter } from '../../modules/subjects/infrastructure/routes/subject.routes.js';
import { createGroupRouter } from '../../modules/groups/infrastructure/routes/group.routes.js';
import { createSubjectGroupRouter } from '../../modules/subject-groups/infrastructure/routes/subject-group.routes.js';
import { createStudentHabilitationRouter } from '../../modules/student-habilitations/infrastructure/routes/student-habilitation.routes.js';
import { createTeacherHabilitationRouter } from '../../modules/teacher-habilitations/infrastructure/routes/teacher-habilitation.routes.js';
import { authenticate } from '../../modules/auth/infrastructure/middleware/authenticate.js';
import { PermissionGuard } from '../../modules/shared/application/guard.js';

export function mountAcademicRoutes(app: Express, dependencies: AppDependencies['academic']): void {
  const { careerRepository, subjectRepository, groupRepository, subjectGroupRepository, studentHabilitationRepository, tokenService, matrixReader, roleGrantRepository } = dependencies;

  app.use('/oral-surgery-subjects', authenticate(tokenService, matrixReader, roleGrantRepository),
    createOralSurgerySubjectRouter({ repository: dependencies.oralSurgerySubjectRepository }));

  app.use(
    '/careers',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createCareerRouter({
      repository: careerRepository,
      listGuard: new PermissionGuard('careers:read'),
    }),
  );

  app.use(
    '/subjects',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createSubjectRouter({
      repository: subjectRepository,
      createGuard: new PermissionGuard('subjects:write'),
      listGuard: new PermissionGuard('subjects:read'),
    }),
  );

  app.use(
    '/groups',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createGroupRouter({
      repository: groupRepository,
      createGuard: new PermissionGuard('groups:write'),
      listGuard: new PermissionGuard('groups:read'),
    }),
  );

  app.use(
    '/subject-groups',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createSubjectGroupRouter({
      repository: subjectGroupRepository,
      createGuard: new PermissionGuard('subject-groups:write'),
      listGuard: new PermissionGuard('subject-groups:read'),
    }),
  );

  app.use(
    '/student-habilitations',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createStudentHabilitationRouter({
      repository: studentHabilitationRepository,
      guard: new PermissionGuard('student-habilitations:write'),
      readGuard: new PermissionGuard('student-habilitations:read'),
    }),
  );
}

// Separate entry preserves the original registration order after clinical mounts.
export function mountTeacherHabilitationRoutes(app: Express, dependencies: AppDependencies['academic']): void {
  const { teacherHabilitationRepository, tokenService, matrixReader, roleGrantRepository } = dependencies;

  // Teacher habilitation activation and period-specific revocation are audited
  // separately; neither changes student periods, assignments, or clinical access.
  app.use(
    '/teacher-habilitations',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createTeacherHabilitationRouter({
      repository: teacherHabilitationRepository,
      guard: new PermissionGuard('teacher-habilitations:write'),
      revokeGuard: new PermissionGuard('teacher-habilitations:revoke'),
      readGuard: new PermissionGuard('teacher-habilitations:read'),
    }),
  );
}
