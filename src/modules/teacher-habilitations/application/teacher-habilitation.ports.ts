import type { TeacherHabilitation } from '../domain/teacher-habilitation.entity.js';

export interface TeacherHabilitationRepositoryPort {
  activate(input: {
    teacherId: string;
    subjectId: string;
    academicGroupId: string;
    activatedBy: string;
  }): Promise<TeacherHabilitation>;
  revoke(input: { id: string; revokedBy: string }): Promise<TeacherHabilitation>;
}
