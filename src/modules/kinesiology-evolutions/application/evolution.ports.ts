import type { EvolutionContent } from '../domain/evolution.js';

export interface EvolutionView {
  id: string; clinical_record_id: string; evaluation_id: string; patient_id: string;
  author_id: string; origin_student_habilitation_id: string; origin_subject_id: string; origin_group_id: string;
  content: EvolutionContent; status: 'draft'; created_at: Date | string; updated_at: Date | string;
}

export interface EvolutionRepositoryPort {
  create(input: { evaluationId: string; patientId: string; subjectId: string; groupId: string; content: EvolutionContent; actorId: string }): Promise<EvolutionView>;
  edit(id: string, content: EvolutionContent, actorId: string): Promise<EvolutionView>;
  detail(id: string, actorId: string): Promise<EvolutionView>;
  list(patientId: string, actorId: string, subjectId?: string, groupId?: string): Promise<EvolutionView[]>;
}
