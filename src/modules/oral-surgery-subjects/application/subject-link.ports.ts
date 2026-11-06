export interface OralSurgerySubjectLink {
  subject_id: string;
  career_id: string;
  created_by: string;
  created_at: Date | string;
}
export interface OralSurgerySubjectRepositoryPort {
  add(subjectId: string, actorId: string): Promise<OralSurgerySubjectLink>;
  list(): Promise<OralSurgerySubjectLink[]>;
}
