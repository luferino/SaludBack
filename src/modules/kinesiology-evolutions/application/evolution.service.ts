import { validateCorrectionReason, validateEvolutionContent } from '../domain/evolution.js';
import type { EvolutionRepositoryPort } from './evolution.ports.js';
import type { KinesiologyListFilters } from '../../kinesiology-evaluations/application/list-filters.js';

export class EvolutionService {
  constructor(private readonly repository: EvolutionRepositoryPort) {}

  create(input: {
    evaluationId: string;
    patientId: string;
    subjectId: string;
    groupId: string;
    content: unknown;
    actorId: string;
  }) {
    return this.repository.create({
      ...input,
      content: validateEvolutionContent(input.content),
    });
  }

  createAmendment(id: string, actorId: string) {
    return this.repository.createAmendment(id, actorId);
  }

  edit(id: string, content: unknown, actorId: string) {
    return this.repository.edit(id, validateEvolutionContent(content), actorId);
  }

  submit(id: string, actorId: string) { return this.repository.submit(id, actorId); }
  requestCorrection(id: string, submissionId: string, reason: string, actorId: string) {
    return this.repository.requestCorrection(id, submissionId, validateCorrectionReason(reason), actorId);
  }
  validate(id: string, submissionId: string, actorId: string) { return this.repository.validate(id, submissionId, actorId); }
  submissions(id: string, actorId: string) { return this.repository.submissions(id, actorId); }
  corrections(id: string, actorId: string) { return this.repository.corrections(id, actorId); }

  detail(id: string, actorId: string) {
    return this.repository.detail(id, actorId);
  }

  list(patientId: string, actorId: string, subjectId?: string, groupId?: string, filters?: KinesiologyListFilters) {
    return filters === undefined
      ? this.repository.list(patientId, actorId, subjectId, groupId)
      : this.repository.list(patientId, actorId, subjectId, groupId, filters);
  }
}
