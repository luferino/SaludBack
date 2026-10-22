import type { TeacherHabilitation } from '../domain/teacher-habilitation.entity.js';

export interface HabilitationListFilter {
  teacherId?: string;
  studentId?: string;
  subjectId?: string;
  academicGroupId?: string;
  status?: 'active' | 'revoked';
}

export interface HabilitationPeriodListing extends HabilitationListFilter {
  teacherId: string;
  id: string;
  activatedBy: string;
  activatedAt: Date | string;
  revokedBy: string | null;
  revokedAt: Date | string | null;
}

export interface TeacherHabilitationRepositoryPort {
  list(input: HabilitationListFilter & { limit: number; offset: number }): Promise<HabilitationPeriodListing[]>;
  activate(input: {
    teacherId: string;
    subjectId: string;
    academicGroupId: string;
    activatedBy: string;
  }): Promise<TeacherHabilitation>;
  revoke(input: { id: string; revokedBy: string }): Promise<TeacherHabilitation>;
}
