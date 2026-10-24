import { validateContent } from '../domain/evaluation.js';
import type { EvaluationContext, EvaluationRepositoryPort } from './evaluation.ports.js';

/** Transport-independent use cases. Atomic contextual workflows are port operations;
 * incoming clinical content validation belongs to the application, not HTTP or SQL.
 */
export class EvaluationService {
  constructor(private readonly repository: EvaluationRepositoryPort) {}

  create(patientId: string, context: EvaluationContext, content: unknown, actorId: string) {
    return this.repository.create(patientId, context, validateContent(content), actorId);
  }

  edit(id: string, content: unknown, actorId: string) {
    return this.repository.edit(id, validateContent(content), actorId);
  }

  createAmendment(id: string, actorId: string) {
    return this.repository.createAmendment(id, actorId);
  }

  submit(id: string, actorId: string) {
    return this.repository.submit(id, actorId);
  }

  requestCorrection(id: string, submissionId: string, reason: string, actorId: string) {
    return this.repository.requestCorrection(id, submissionId, reason, actorId);
  }

  validate(id: string, submissionId: string, actorId: string) {
    return this.repository.validate(id, submissionId, actorId);
  }

  corrections(id: string, actorId: string) {
    return this.repository.corrections(id, actorId);
  }

  submissions(id: string, actorId: string) {
    return this.repository.submissions(id, actorId);
  }

  consent(id: string, actorId: string) {
    return this.repository.consent(id, actorId);
  }

  verifyConsent(id: string, date: string, actorId: string) {
    return this.repository.verifyConsent(id, date, actorId);
  }

  detail(id: string, actorId: string) {
    return this.repository.detail(id, actorId);
  }

  list(patientId: string, actorId: string, subjectId?: string, groupId?: string) {
    return this.repository.list(patientId, actorId, subjectId, groupId);
  }
}
