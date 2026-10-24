import type { AssignmentInput } from '../domain/patient-assignment.js';
import type { PatientAssignmentRepositoryPort } from './patient-assignment.ports.js';

/** Entry points independent of HTTP and PostgreSQL. Live context checks and state
 * policies stay inside atomic port operations, never separate preflight reads.
 */
export class PatientAssignmentService {
  constructor(private readonly repository: PatientAssignmentRepositoryPort) {}

  create(input: AssignmentInput) {
    return this.repository.create(input);
  }

  reassign(id: string, input: Omit<AssignmentInput, 'patientId'>) {
    return this.repository.reassign(id, input);
  }

  end(id: string, actorId: string, reason: string) {
    return this.repository.end(id, actorId, reason);
  }

  listTeacher(actorId: string, limit: number, offset: number) {
    return this.repository.listTeacher(actorId, limit, offset);
  }

  listOwn(actorId: string, limit: number, offset: number) {
    return this.repository.listOwn(actorId, limit, offset);
  }
}
