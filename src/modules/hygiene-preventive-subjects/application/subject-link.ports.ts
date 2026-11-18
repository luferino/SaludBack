export interface HygienePreventiveSubjectLink {
  subject_id: string;
  career_id: string;
  created_by: string;
  created_at: Date | string;
}
export interface HygienePreventiveSubjectContext {
  subject_id: string;
  academic_group_id: string;
}
export interface HygienePreventiveSubjectRepositoryPort {
  add(subjectId: string, actorId: string): Promise<HygienePreventiveSubjectLink>;
  list(): Promise<HygienePreventiveSubjectLink[]>;
  listMine(actorId: string, role: 'estudiante' | 'teacher'): Promise<HygienePreventiveSubjectContext[]>;
}
