import type { EvolutionContent } from '../domain/evolution.js';
import type { KinesiologyListFilters } from '../../kinesiology-evaluations/application/list-filters.js';

export interface EvolutionSubmission {
  id: string;
  evolution_id: string;
  ordinal: string;
  submitted_by: string;
  submitted_at: Date | string;
  content: EvolutionContent;
  reviewed_at?: Date | string | null;
  reviewed_by?: string | null;
  validation_status: 'pending_validation' | 'validated';
  amendment_of_evolution_id?: string;
}
export interface EvolutionCorrection {
  submission_id: string;
  reason: string;
  reviewed_by: string;
  requested_at: Date | string;
}
export interface EvolutionCorrectionResult extends EvolutionCorrection {
  evolution_id: string;
  amendment_of_evolution_id?: string;
  correction_request_id: string;
  status: 'draft';
}
export interface EvolutionValidationResult {
  evolution_id: string;
  submission_id: string;
  status: 'validated';
  reviewed_by: string;
  reviewed_at: Date | string;
}
export interface EvolutionView {
  id: string; clinical_record_id: string; evaluation_id: string; patient_id: string;
  author_id: string; origin_student_habilitation_id: string; origin_subject_id: string;
  origin_group_id: string; content: EvolutionContent; status: 'draft' | 'submitted' | 'validated';
  projected_submission_id?: string | null; projected_submitted_by?: string | null;
  projected_submitted_at?: Date | string | null;
  projected_reviewed_by?: string | null;
  projected_reviewed_at?: Date | string | null;
  validation_status?: 'pending_validation' | 'validated';
  amendment_of_evolution_id?: string | null;
  created_at: Date | string; updated_at: Date | string;
}
export interface EvolutionRepositoryPort {
  create(input: { evaluationId: string; patientId: string; subjectId: string; groupId: string; content: EvolutionContent; actorId: string }): Promise<EvolutionView>;
  createAmendment(id: string, actorId: string): Promise<EvolutionView>;
  edit(id: string, content: EvolutionContent, actorId: string): Promise<EvolutionView>;
  submit(id: string, actorId: string): Promise<EvolutionSubmission>;
  requestCorrection(id: string, submissionId: string, reason: string, actorId: string): Promise<EvolutionCorrectionResult>;
  validate(id: string, submissionId: string, actorId: string): Promise<EvolutionValidationResult>;
  submissions(id: string, actorId: string): Promise<{ evolution_id: string; amendment_of_evolution_id?: string; items: EvolutionSubmission[] }>;
  corrections(id: string, actorId: string): Promise<{ evolution_id: string; amendment_of_evolution_id?: string; items: EvolutionCorrection[] }>;
  detail(id: string, actorId: string): Promise<EvolutionView>;
  list(patientId: string, actorId: string, subjectId?: string, groupId?: string, filters?: KinesiologyListFilters): Promise<EvolutionView[]>;
}
