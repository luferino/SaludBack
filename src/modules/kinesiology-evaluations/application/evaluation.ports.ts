import type { Evaluation, EvaluationContent, PatientDemographics } from '../domain/evaluation.js';

export interface EvaluationContext {
  subjectId: string;
  groupId: string;
}

export interface EvaluationView extends Evaluation {
  projected_submission_id?: string | null;
  projected_submission_ordinal?: string | null;
  projected_submitted_by?: string | null;
  projected_submitted_at?: Date | string | null;
  projected_age_at_admission?: number | null;
  projected_consent?: Record<string, unknown> | null;
}

export interface ConsentEvidence {
  id: string;
  paper_signature_date: string;
  verified_by: string;
  verified_at: string;
}
export interface ConsentResult {
  evaluation_id: string;
  status: string;
  evidence: ConsentEvidence | null;
}
export interface SubmissionResult {
  id: string;
  evaluation_id: string;
  ordinal: string;
  submitted_by: string;
  submitted_at: string;
  status: string;
  clinical_content: EvaluationContent;
  studies: NonNullable<EvaluationContent['studies']>;
  patient: PatientDemographics;
  age_at_admission: number | null;
  consent: ConsentEvidence;
}
export interface CorrectionResult {
  evaluation_id: string;
  submission_id: string;
  status: string;
  correction_request_id: string;
  requested_at: string;
}
export interface ValidationResult {
  evaluation_id: string;
  submission_id: string;
  status: string;
  reviewed_by: string;
  reviewed_at: string;
}
export interface CorrectionHistory {
  evaluation_id: string;
  items: Array<{ submission_id: string; reason: string; reviewed_by: string; requested_at: string }>;
}
export interface SubmissionHistory {
  evaluation_id: string;
  amendment_of_evaluation_id?: unknown;
  items: Array<Record<string, unknown>>;
}

/** Atomic operations: adapters revalidate live access under ordered locks.
 * Do not compose unlocked reads and separate writes to implement mutations.
 * Clinical policies must run against locked state within the operation.
 */
export interface EvaluationRepositoryPort {
  create(patientId: string, context: EvaluationContext, content: EvaluationContent, actorId: string): Promise<EvaluationView>;
  createAmendment(id: string, actorId: string): Promise<EvaluationView>;
  submit(id: string, actorId: string): Promise<SubmissionResult>;
  requestCorrection(id: string, submissionId: string, reason: string, actorId: string): Promise<CorrectionResult>;
  validate(id: string, submissionId: string, actorId: string): Promise<ValidationResult>;
  corrections(id: string, actorId: string): Promise<CorrectionHistory>;
  submissions(id: string, actorId: string): Promise<SubmissionHistory>;
  edit(id: string, content: EvaluationContent, actorId: string): Promise<EvaluationView>;
  consent(id: string, actorId: string): Promise<ConsentResult>;
  verifyConsent(id: string, paperSignatureDate: string, actorId: string): Promise<ConsentResult>;
  detail(id: string, actorId: string): Promise<EvaluationView>;
  list(patientId: string, actorId: string, subjectId?: string, groupId?: string): Promise<EvaluationView[]>;
}
