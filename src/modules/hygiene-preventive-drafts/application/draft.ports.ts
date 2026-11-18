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
export interface ProcedureInput { procedureDate: string; description: string }
export interface ProcedureRow {
  id: string; draft_id: string; procedure_date: string; description: string; author_id: string;
  student_name: string | null; version: string; approved_by: string | null; teacher_name: string | null;
  approved_at: Date | string | null; created_at: Date | string; updated_at: Date | string;
}
export interface DraftRepositoryPort {
  create(input: DraftInput, actor: DraftActor): Promise<DraftRow>;
  get(id: string, actor: DraftActor): Promise<DraftRow>;
  list(filter: DraftFilter, actor: DraftActor): Promise<DraftRow[]>;
  edit(id: string, version: string, content: DraftContent, actor: DraftActor): Promise<DraftRow>;
  listProcedures(draftId: string, actor: DraftActor): Promise<ProcedureRow[]>;
  addProcedure(draftId: string, input: ProcedureInput, actor: DraftActor): Promise<ProcedureRow>;
  editProcedure(draftId: string, procedureId: string, version: string, input: ProcedureInput,
    actor: DraftActor): Promise<ProcedureRow>;
  deleteProcedure(draftId: string, procedureId: string, version: string, actor: DraftActor): Promise<void>;
  approveProcedure(draftId: string, procedureId: string, version: string, actor: DraftActor): Promise<ProcedureRow>;
}
