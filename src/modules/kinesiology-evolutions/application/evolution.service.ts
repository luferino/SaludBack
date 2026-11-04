import { validateEvolutionContent } from '../domain/evolution.js';
import type { EvolutionRepositoryPort } from './evolution.ports.js';

export class EvolutionService {
  constructor(private readonly repository: EvolutionRepositoryPort) {}
  create(input: { evaluationId: string; patientId: string; subjectId: string; groupId: string; content: unknown; actorId: string }) {
    return this.repository.create({ ...input, content: validateEvolutionContent(input.content) });
  }
  edit(id: string, content: unknown, actorId: string) { return this.repository.edit(id, validateEvolutionContent(content), actorId); }
  submit(id: string, actorId: string) { return this.repository.submit(id, actorId); }
  submissions(id: string, actorId: string) { return this.repository.submissions(id, actorId); }
  detail(id: string, actorId: string) { return this.repository.detail(id, actorId); }
  list(patientId: string, actorId: string, subjectId?: string, groupId?: string) { return this.repository.list(patientId, actorId, subjectId, groupId); }
}
