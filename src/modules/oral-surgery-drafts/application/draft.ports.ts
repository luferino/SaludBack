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
export interface ConsentDeclaration {
  id: string; draft_id: string; draft_version: string; plan_revision: string;
  treatment_plan: unknown; declared_by: string; declared_at: Date | string;
}
export interface ConsentHistory {
  draft_version: string; plan_revision: string; current_declaration_id: string | null;
  declarations: ConsentDeclaration[];
}
export interface SurgeryAuthorization {
  id: string; draft_id: string; draft_version: string; consent_declaration_id: string;
  reviewed_content: DraftContent; authorized_by: string; teacher_habilitation_id: string;
  authorized_at: Date | string;
}
export interface AuthorizationHistory {
  draft_version: string; current_authorization_id: string | null;
  authorizations: SurgeryAuthorization[];
}
export interface DraftRepositoryPort {
  authorizeSurgery(id: string, version: string, consentId: string, actor: DraftActor): Promise<SurgeryAuthorization>;
  authorizationHistory(id: string, actor: DraftActor): Promise<AuthorizationHistory>;
  declareConsent(id: string, version: string, actor: DraftActor): Promise<ConsentDeclaration>;
  consentHistory(id: string, actor: DraftActor): Promise<ConsentHistory>;
  create(input: DraftInput, actor: DraftActor): Promise<DraftRow>;
  get(id: string, actor: DraftActor): Promise<DraftRow>;
  list(filter: DraftFilter, actor: DraftActor): Promise<DraftRow[]>;
  edit(id: string, version: string, content: DraftContent, actor: DraftActor): Promise<DraftRow>;
}
