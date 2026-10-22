import type { StudentHabilitation } from '../domain/student-habilitation.entity.js';

export interface StudentHabilitationListInput {
  studentId?: string;
  subjectId?: string;
  academicGroupId?: string;
  status?: 'active' | 'revoked';
  limit: number;
  offset: number;
  actorId: string | null;
  isAdmin: boolean;
}

export interface StudentHabilitationListing {
  id: string;
  studentId: string;
  subjectId: string;
  academicGroupId: string;
  activatedBy: string;
  activatedAt: Date | string;
  revokedBy: string | null;
  revokedAt: Date | string | null;
}

export interface StudentHabilitationRepositoryPort {
  list(input: StudentHabilitationListInput): Promise<StudentHabilitationListing[]>;
  activate(input: { studentId: string; subjectId: string; academicGroupId: string; activatedBy: string }): Promise<StudentHabilitation>;
  revoke(input: { id: string; revokedBy: string }): Promise<StudentHabilitation>;
}
