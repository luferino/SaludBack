import type { SubjectGroup } from '../domain/subject-group.entity.js';

export interface SubjectGroupRepositoryPort {
  create(subjectGroup: SubjectGroup): Promise<SubjectGroup>;
  list(options: { subjectId?: string; limit: number; offset: number }): Promise<SubjectGroup[]>;
}
