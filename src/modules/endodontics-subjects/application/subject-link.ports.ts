export interface EndodonticsSubjectLink {
  subject_id: string;
  career_id: string;
  created_by: string;
  created_at: Date | string;
}

export interface EndodonticsSubjectRepositoryPort {
  add(subjectId: string, actorId: string): Promise<EndodonticsSubjectLink>;
  list(): Promise<EndodonticsSubjectLink[]>;
}
