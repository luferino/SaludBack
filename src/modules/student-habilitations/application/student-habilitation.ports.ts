import type { StudentHabilitation } from '../domain/student-habilitation.entity.js';

export interface StudentHabilitationRepositoryPort {
  activate(input: { studentId: string; subjectId: string; academicGroupId: string; activatedBy: string }): Promise<StudentHabilitation>;
}
