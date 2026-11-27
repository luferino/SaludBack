import type { DraftActor } from './draft.ports.js';
import type { TreatmentContent } from '../domain/treatment-content.js';

export interface TreatmentReportRow {
  draft_id: string; content: TreatmentContent; version: string; status: 'draft' | 'closed';
  created_by: string; created_at: Date | string; updated_at: Date | string;
  closed_by: string | null; closed_at: Date | string | null; teacher_habilitation_id: string | null;
}

// One report per diagnostic draft, addressed by the draft id. Writes are author-only, closing is teacher-only.
export interface TreatmentReportRepositoryPort {
  createTreatmentReport(draftId: string, content: TreatmentContent, actor: DraftActor): Promise<TreatmentReportRow>;
  editTreatmentReport(draftId: string, version: string, content: TreatmentContent, actor: DraftActor): Promise<TreatmentReportRow>;
  getTreatmentReport(draftId: string, actor: DraftActor): Promise<TreatmentReportRow>;
  closeTreatmentReport(draftId: string, version: string, draftVersion: string, actor: DraftActor): Promise<TreatmentReportRow>;
}
