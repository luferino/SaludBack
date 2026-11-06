import type { DraftContent } from '../domain/content.js';

export interface DraftActor { id: string; role: string }
export interface DraftInput { patientId: string; subjectId: string; groupId: string; content: DraftContent }
export interface DraftFilter { patientId?: string; subjectId?: string; groupId?: string; limit: number; offset: number }
export interface DraftRow {
  id: string; clinical_record_id: string; patient_id: string; author_id: string;
  origin_student_habilitation_id: string; origin_subject_id: string; origin_group_id: string;
  content: DraftContent; status: 'draft'; version: string;
  created_at: Date | string; updated_at: Date | string;
}
export interface DraftRepositoryPort {
  create(input: DraftInput, actor: DraftActor): Promise<DraftRow>;
  get(id: string, actor: DraftActor): Promise<DraftRow>;
  list(filter: DraftFilter, actor: DraftActor): Promise<DraftRow[]>;
  edit(id: string, version: string, content: DraftContent, actor: DraftActor): Promise<DraftRow>;
}
