import type { Pool } from 'pg';
import config from '../config.js';
import { PgUserRepository } from '../modules/auth/infrastructure/repositories/pg-user.repository.js';
import { PgResetTokenRepository } from '../modules/auth/infrastructure/repositories/pg-reset-token.repository.js';
import { PgPermissionMatrixRepository } from '../modules/auth/infrastructure/repositories/pg-permission-matrix.repository.js';
import { BcryptHasher } from '../modules/auth/infrastructure/services/bcrypt-hasher.service.js';
import { JwtTokenService } from '../modules/auth/infrastructure/services/jwt-token.service.js';
import { ConsoleMailer } from '../modules/auth/infrastructure/services/console-mailer.service.js';
import { PgPatientRepository } from '../modules/patients/infrastructure/repositories/pg-patient.repository.js';
import { PgStudentRepository } from '../modules/students/infrastructure/repositories/pg-student.repository.js';
import { PgTeacherRepository } from '../modules/teachers/infrastructure/repositories/pg-teacher.repository.js';
import { PgOralSurgeryDraftRepository } from '../modules/oral-surgery-drafts/index.js';
import { PgOralSurgerySubjectRepository } from '../modules/oral-surgery-subjects/index.js';
import { PgCareerRepository } from '../modules/careers/infrastructure/repositories/pg-career.repository.js';
import { PgSubjectRepository } from '../modules/subjects/infrastructure/repositories/pg-subject.repository.js';
import { PgGroupRepository } from '../modules/groups/infrastructure/repositories/pg-group.repository.js';
import { PgSubjectGroupRepository } from '../modules/subject-groups/infrastructure/repositories/pg-subject-group.repository.js';
import { PgTeacherHabilitationRepository } from '../modules/teacher-habilitations/infrastructure/repositories/pg-teacher-habilitation.repository.js';
import { PgStudentHabilitationRepository } from '../modules/student-habilitations/infrastructure/repositories/pg-student-habilitation.repository.js';
import { PgPatientAssignmentRepository } from '../modules/patient-assignments/index.js';
import { PgPatientAvailabilityRepository } from '../modules/patient-availabilities/index.js';
import { PgPatientAssignmentOptionsRepository } from '../modules/patient-assignment-options/index.js';
import { PgUnitOfWork } from '../modules/shared/infrastructure/pg-unit-of-work.js';
import { PgKinesiologyEvaluationRepository } from '../modules/kinesiology-evaluations/index.js';
import { PgKinesiologyEvolutionRepository } from '../modules/kinesiology-evolutions/index.js';

/** Build one app-local object graph; shared services are never global singletons. */
export function createDependencies(pool: Pool) {
  const repository = new PgUserRepository(pool);
  const resetTokenRepository = new PgResetTokenRepository(pool, config.resetTokenMaxOutstanding);
  const mailer = new ConsoleMailer();
  const patientRepository = new PgPatientRepository(pool);
  const studentRepository = new PgStudentRepository(pool);
  const teacherRepository = new PgTeacherRepository(pool);
  const careerRepository = new PgCareerRepository(pool);
  const oralSurgerySubjectRepository = new PgOralSurgerySubjectRepository(pool);
  const subjectRepository = new PgSubjectRepository(pool);
  const groupRepository = new PgGroupRepository(pool);
  const subjectGroupRepository = new PgSubjectGroupRepository(pool);
  const teacherHabilitationRepository = new PgTeacherHabilitationRepository(pool);
  const unitOfWork = new PgUnitOfWork(pool);
  const studentHabilitationRepository = new PgStudentHabilitationRepository(unitOfWork, pool);
  const patientAssignmentRepository = new PgPatientAssignmentRepository(unitOfWork, pool);
  const patientAvailabilityRepository = new PgPatientAvailabilityRepository(unitOfWork, pool);
  const patientAssignmentOptionsRepository = new PgPatientAssignmentOptionsRepository(pool);
  const kinesiologyEvaluationRepository = new PgKinesiologyEvaluationRepository(unitOfWork, pool);
  const kinesiologyEvolutionRepository = new PgKinesiologyEvolutionRepository(unitOfWork, pool);
  const oralSurgeryDraftRepository = new PgOralSurgeryDraftRepository(unitOfWork, pool);
  const hasher = new BcryptHasher(config.bcryptCost);
  const tokenService = new JwtTokenService({
    secret: config.jwtSecret,
    secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets,
    expiresIn: config.jwtExpiresIn,
  });
  const matrixReader = new PgPermissionMatrixRepository(pool);

  return {
    auth: {
      repository, resetTokenRepository, mailer, hasher, tokenService, matrixReader,
      clientUrl: config.clientUrl, resetTokenTtl: config.resetTokenTtl,
    },
    profiles: {
      patientRepository, studentRepository, teacherRepository,
      userRepository: repository, hasher, unitOfWork, tokenService, matrixReader,
    },
    academic: {
      careerRepository, oralSurgerySubjectRepository, subjectRepository, groupRepository, subjectGroupRepository,
      studentHabilitationRepository, teacherHabilitationRepository,
      tokenService, matrixReader,
    },
    clinical: {
      oralSurgeryDraftRepository,
      assignmentRepository: patientAssignmentRepository,
      availabilityRepository: patientAvailabilityRepository,
      assignmentOptionsRepository: patientAssignmentOptionsRepository,
      evaluationRepository: kinesiologyEvaluationRepository,
      evolutionRepository: kinesiologyEvolutionRepository,
      tokenService, matrixReader,
    },
  };
}

export type AppDependencies = ReturnType<typeof createDependencies>;
