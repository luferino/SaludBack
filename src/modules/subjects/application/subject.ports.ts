import type { Subject } from '../domain/subject.entity.js';

export interface SubjectRepositoryPort {
  create(subject: Subject): Promise<Subject>;
  list(options: { careerId?: string; q?: string; limit: number; offset: number }): Promise<Subject[]>;
}
