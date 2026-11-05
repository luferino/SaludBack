import type { SubjectGroup } from '../domain/subject-group.entity.js';

export interface SubjectGroupCareerPair {
  subjectCareerId: string | null;
  academicGroupCareerId: string | null;
}

export interface SubjectGroupRepositoryPort {
  findCareerPair(options: { subjectId: string; academicGroupId: string }): Promise<SubjectGroupCareerPair>;
  create(subjectGroup: SubjectGroup): Promise<SubjectGroup>;
  list(options: { subjectId?: string; limit: number; offset: number }): Promise<SubjectGroup[]>;
}
