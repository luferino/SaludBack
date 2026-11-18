export interface HygienePreventiveSubjectLink {
  subject_id: string;
  career_id: string;
  created_by: string;
  created_at: Date | string;
}
export interface HygienePreventiveSubjectRepositoryPort {
  add(subjectId: string, actorId: string): Promise<HygienePreventiveSubjectLink>;
  list(): Promise<HygienePreventiveSubjectLink[]>;
}
