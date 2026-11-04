import type { EvolutionContent } from '../domain/evolution.js';

export interface EvolutionSubmission {
  id: string;
  evolution_id: string;
  ordinal: string;
  submitted_by: string;
  submitted_at: Date | string;
  content: EvolutionContent;
  reviewed_by?: string | null;
  reviewed_at?: Date | string | null;
  validation_status: 'pending_validation' | 'validated';
}

export interface EvolutionView {
  id: string; clinical_record_id: string; evaluation_id: string; patient_id: string;
  author_id: string; origin_student_habilitation_id: string; origin_subject_id: string; origin_group_id: string;
  content: EvolutionContent; status: 'draft' | 'submitted' | 'validated';
  projected_submission_id?: string | null; projected_submitted_by?: string | null;
  projected_submitted_at?: Date | string | null; projected_reviewed_by?: string | null;
  projected_reviewed_at?: Date | string | null; validation_status?: 'pending_validation' | 'validated';
  created_at: Date | string; updated_at: Date | string;
}

export interface EvolutionRepositoryPort {
  create(input: { evaluationId: string; patientId: string; subjectId: string; groupId: string; content: EvolutionContent; actorId: string }): Promise<EvolutionView>;
  edit(id: string, content: EvolutionContent, actorId: string): Promise<EvolutionView>;
  submit(id: string, actorId: string): Promise<EvolutionSubmission>;
  submissions(id: string, actorId: string): Promise<{ evolution_id: string; items: EvolutionSubmission[] }>;
  detail(id: string, actorId: string): Promise<EvolutionView>;
  list(patientId: string, actorId: string, subjectId?: string, groupId?: string): Promise<EvolutionView[]>;
}
