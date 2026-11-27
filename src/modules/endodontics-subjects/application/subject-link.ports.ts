export interface EndodonticsSubjectLink {
  subject_id: string;
  career_id: string;
  created_by: string;
  created_at: Date | string;
}

export interface EndodonticsSubjectContext { subject_id: string; academic_group_id: string }

export interface EndodonticsSubjectRepositoryPort {
  add(subjectId: string, actorId: string): Promise<EndodonticsSubjectLink>;
  list(): Promise<EndodonticsSubjectLink[]>;
  listMine(actorId: string, role: 'estudiante' | 'teacher'): Promise<EndodonticsSubjectContext[]>;
}
