import { User } from '../../auth/domain/user.entity.js';
import type { UserRepositoryPort, PasswordHasherPort } from '../../auth/application/auth.ports.js';
import { Student } from '../domain/student.entity.js';
import { BadRequestError, ConflictError } from '../../shared/domain/errors.js';
import type { StudentRepositoryPort } from './student.ports.js';
import type { UnitOfWorkPort } from '../../shared/application/unit-of-work.js';

export interface CreateStudentInput {
  username: string;
  password: string;
  nombres: string;
  apellidos: string;
  codalumno: string;
  email?: string | null;
  celular?: string | null;
  createdBy?: string | null;
}

const REQUIRED_FIELDS = ['username', 'password', 'nombres', 'apellidos', 'codalumno'] as const;

const CODALUMNO_PATTERN = /^[A-Za-z0-9]+$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;

/**
 * Create Student (alta en uno) use case.
 * One request creates the access account (role `estudiante`, hashed
 * password) and the `students` profile row together, or links the
 * student to an existing account (STU-001/STU-002). Validation order
 * (STU-003): required fields (400) -> codalumno format (400) -> email
 * format when present (400) -> duplicate codalumno (409) -> create-or-
 * link. The user write and the student write share one transaction via
 * the injected UnitOfWork, so both persist or neither does (AUD-003).
 */
export class CreateStudent {
  private readonly studentRepository: StudentRepositoryPort;
  private readonly userRepository: UserRepositoryPort;
  private readonly hasher: PasswordHasherPort;
  private readonly unitOfWork: UnitOfWorkPort;

  constructor({
    studentRepository,
    userRepository,
    hasher,
    unitOfWork,
  }: {
    studentRepository: StudentRepositoryPort;
    userRepository: UserRepositoryPort;
    hasher: PasswordHasherPort;
    unitOfWork: UnitOfWorkPort;
  }) {
    this.studentRepository = studentRepository;
    this.userRepository = userRepository;
    this.hasher = hasher;
    this.unitOfWork = unitOfWork;
  }

  async execute(input: CreateStudentInput): Promise<Student> {
    for (const field of REQUIRED_FIELDS) {
      const value = input[field];
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        throw new BadRequestError(`${field} is required`);
      }
    }

    const username = input.username.trim();
    const codalumno = input.codalumno.trim();
    if (!CODALUMNO_PATTERN.test(codalumno)) {
      throw new BadRequestError('codalumno must contain only letters and digits');
    }

    const email = normalizeOptional(input.email);
    if (email !== null && !EMAIL_PATTERN.test(email)) {
      throw new BadRequestError('email must be a valid local@domain address');
    }
    const celular = normalizeOptional(input.celular);

    const existing = await this.studentRepository.findByCodalumno(codalumno);
    if (existing) {
      throw new ConflictError(`codalumno already exists: ${codalumno}`);
    }

    // Create-or-link: an existing username SHORT-CIRCUITS the email
    // lookup; otherwise an email match links to that account. Linked
    // accounts keep their credentials and role (STU-002).
    let linkedUser = await this.userRepository.findByUsername(username);
    if (!linkedUser && email !== null) {
      linkedUser = await this.userRepository.findByEmail(email);
    }

    const passwordHash = linkedUser ? null : await this.hasher.hash(input.password);

    return this.unitOfWork.withTransaction(async (client) => {
      const user =
        linkedUser ??
        (await this.userRepository.create(
          User.create({ username, passwordHash: passwordHash!, role: 'estudiante', email }),
          client,
        ));

      const student = Student.create({
        userId: user.id!,
        nombres: input.nombres,
        apellidos: input.apellidos,
        codalumno,
        email,
        celular,
        createdBy: input.createdBy ?? null,
      });

      return this.studentRepository.create(student, client);
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