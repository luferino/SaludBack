import { User } from '../../auth/domain/user.entity.js';
import type { UserRepositoryPort, PasswordHasherPort } from '../../auth/application/auth.ports.js';
import { Teacher } from '../domain/teacher.entity.js';
import { BadRequestError } from '../../shared/domain/errors.js';
import type { TeacherRepositoryPort } from './teacher.ports.js';
import type { UnitOfWorkPort } from '../../shared/application/unit-of-work.js';

export interface CreateTeacherInput {
  username: string;
  password: string;
  nombres: string;
  apellidos: string;
  email?: string | null;
  celular?: string | null;
  createdBy?: string | null;
}

const REQUIRED_FIELDS = ['username', 'password', 'nombres', 'apellidos'] as const;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;

/**
 * Create Teacher (alta en uno) use case.
 * One request creates the access account (role `teacher`, hashed
 * password) and the `teachers` profile row together, or links the
 * teacher to an existing account (TEA-001/TEA-002). Validation order:
 * required fields (400) -> email format when present (400) -> create-or-
 * link. Teachers have no `codalumno`, so there is no duplicate-code
 * 409 branch (unlike students). The user write and the teacher write
 * share one transaction via the injected UnitOfWork, so both persist or
 * neither does (AUD-003).
 */
export class CreateTeacher {
  private readonly teacherRepository: TeacherRepositoryPort;
  private readonly userRepository: UserRepositoryPort;
  private readonly hasher: PasswordHasherPort;
  private readonly unitOfWork: UnitOfWorkPort;

  constructor({
    teacherRepository,
    userRepository,
    hasher,
    unitOfWork,
  }: {
    teacherRepository: TeacherRepositoryPort;
    userRepository: UserRepositoryPort;
    hasher: PasswordHasherPort;
    unitOfWork: UnitOfWorkPort;
  }) {
    this.teacherRepository = teacherRepository;
    this.userRepository = userRepository;
    this.hasher = hasher;
    this.unitOfWork = unitOfWork;
  }

  async execute(input: CreateTeacherInput): Promise<Teacher> {
    for (const field of REQUIRED_FIELDS) {
      const value = input[field];
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        throw new BadRequestError(`${field} is required`);
      }
    }

    const username = input.username.trim();

    const email = normalizeOptional(input.email);
    if (email !== null && !EMAIL_PATTERN.test(email)) {
      throw new BadRequestError('email must be a valid local@domain address');
    }
    const celular = normalizeOptional(input.celular);

    // Create-or-link: an existing username SHORT-CIRCUITS the email
    // lookup; otherwise an email match links to that account. Linked
    // accounts keep their credentials and role (TEA-002).
    let linkedUser = await this.userRepository.findByUsername(username);
    if (!linkedUser && email !== null) {
      linkedUser = await this.userRepository.findByEmail(email);
    }

    const passwordHash = linkedUser ? null : await this.hasher.hash(input.password);

    return this.unitOfWork.withTransaction(async (client) => {
      const user =
        linkedUser ??
        (await this.userRepository.create(
          User.create({ username, passwordHash: passwordHash!, role: 'teacher', email }),
          client,
        ));

      const teacher = Teacher.create({
        userId: user.id!,
        nombres: input.nombres,
        apellidos: input.apellidos,
        email,
        celular,
        createdBy: input.createdBy ?? null,
      });

      return this.teacherRepository.create(teacher, client);
    });
  }
}

/**
 * Normalizes an optional string field: absent, all-whitespace, and empty
 * values become `null` (accounts created by alta en uno MAY have no
 * email — UAC-002); present values are trimmed.
 */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}