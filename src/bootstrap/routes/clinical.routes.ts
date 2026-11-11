import type { Express } from 'express';
import type { AppDependencies } from '../create-dependencies.js';
import { createOralSurgeryDraftRouter } from '../../modules/oral-surgery-drafts/index.js';
import { createPatientAssignmentRouter } from '../../modules/patient-assignments/index.js';
import { createPatientAvailabilityRouter } from '../../modules/patient-availabilities/index.js';
import { createPatientAssignmentOptionsRouter } from '../../modules/patient-assignment-options/index.js';
import { createKinesiologyEvaluationRouter } from '../../modules/kinesiology-evaluations/index.js';
import { createKinesiologyEvolutionRouter } from '../../modules/kinesiology-evolutions/index.js';
import { authenticate } from '../../modules/auth/infrastructure/middleware/authenticate.js';

export function mountClinicalRoutes(app: Express, dependencies: AppDependencies['clinical']): void {
  const { assignmentRepository, availabilityRepository, assignmentOptionsRepository, evaluationRepository, evolutionRepository, tokenService, matrixReader, roleGrantRepository } = dependencies;

  app.use('/oral-surgery-drafts', authenticate(tokenService, matrixReader, roleGrantRepository),
    createOralSurgeryDraftRouter({ repository: dependencies.oralSurgeryDraftRepository }));

  app.use(
    '/patient-availabilities',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createPatientAvailabilityRouter({ repository: availabilityRepository }),
  );

  app.use(
    '/patient-assignment-options',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createPatientAssignmentOptionsRouter({ repository: assignmentOptionsRepository }),
  );

  app.use(
    '/patient-assignments',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createPatientAssignmentRouter({ repository: assignmentRepository }),
  );

  app.use(
    '/kinesiology-evaluations',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createKinesiologyEvaluationRouter({ repository: evaluationRepository }),
  );

  app.use(
    '/kinesiology-evolutions',
    authenticate(tokenService, matrixReader, roleGrantRepository),
    createKinesiologyEvolutionRouter({ repository: evolutionRepository }),
  );
}
