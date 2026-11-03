import type { Express } from 'express';
import type { AppDependencies } from '../create-dependencies.js';
import { createPatientAssignmentRouter } from '../../modules/patient-assignments/index.js';
import { createPatientAvailabilityRouter } from '../../modules/patient-availabilities/index.js';
import { createPatientAssignmentOptionsRouter } from '../../modules/patient-assignment-options/index.js';
import { createKinesiologyEvaluationRouter } from '../../modules/kinesiology-evaluations/index.js';
import { createKinesiologyEvolutionRouter } from '../../modules/kinesiology-evolutions/index.js';
import { authenticate } from '../../modules/auth/infrastructure/middleware/authenticate.js';

export function mountClinicalRoutes(app: Express, dependencies: AppDependencies['clinical']): void {
  const { assignmentRepository, availabilityRepository, assignmentOptionsRepository, evaluationRepository, evolutionRepository, tokenService, matrixReader } = dependencies;

  app.use(
    '/patient-availabilities',
    authenticate(tokenService, matrixReader),
    createPatientAvailabilityRouter({ repository: availabilityRepository }),
  );

  app.use(
    '/patient-assignment-options',
    authenticate(tokenService, matrixReader),
    createPatientAssignmentOptionsRouter({ repository: assignmentOptionsRepository }),
  );

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

  app.use(
    '/kinesiology-evolutions',
    authenticate(tokenService, matrixReader),
    createKinesiologyEvolutionRouter({ repository: evolutionRepository }),
  );
}
