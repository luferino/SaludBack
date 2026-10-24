import type { Express } from 'express';
import type { AppDependencies } from '../create-dependencies.js';
import { createPatientAssignmentRouter } from '../../modules/patient-assignments/index.js';
import { createKinesiologyEvaluationRouter } from '../../modules/kinesiology-evaluations/index.js';
import { authenticate } from '../../modules/auth/infrastructure/middleware/authenticate.js';

export function mountClinicalRoutes(app: Express, dependencies: AppDependencies['clinical']): void {
  const { assignmentRepository, evaluationRepository, tokenService, matrixReader } = dependencies;

  app.use(
    '/patient-assignments',
    authenticate(tokenService, matrixReader),
    createPatientAssignmentRouter({ repository: assignmentRepository }),
  );

  app.use(
    '/kinesiology-evaluations',
    authenticate(tokenService, matrixReader),
    createKinesiologyEvaluationRouter({ repository: evaluationRepository }),
  );
}
