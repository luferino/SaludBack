export class StudentHabilitation {
  id: string;
  studentId: string;
  subjectId: string;
  academicGroupId: string;
  activatedBy: string;
  activatedAt: Date | string;
  revokedBy: string | null;
  revokedAt: Date | string | null;

  constructor(input: { id: string; studentId: string; subjectId: string; academicGroupId: string; activatedBy: string; activatedAt: Date | string; revokedBy?: string | null; revokedAt?: Date | string | null }) {
    this.id = input.id;
    this.studentId = input.studentId;
    this.subjectId = input.subjectId;
    this.academicGroupId = input.academicGroupId;
    this.activatedBy = input.activatedBy;
    this.activatedAt = input.activatedAt;
    this.revokedBy = input.revokedBy ?? null;
    this.revokedAt = input.revokedAt ?? null;
  }

  toJSON() {
    return { id: this.id, student_id: this.studentId, subject_id: this.subjectId, academic_group_id: this.academicGroupId, activated_by: this.activatedBy, activated_at: new Date(this.activatedAt).toISOString(), revoked_by: this.revokedBy, revoked_at: this.revokedAt === null ? null : new Date(this.revokedAt).toISOString() };
  }
}
