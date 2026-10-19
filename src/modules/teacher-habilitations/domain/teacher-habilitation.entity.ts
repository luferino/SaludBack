export class TeacherHabilitation {
  id: string;
  teacherId: string;
  subjectId: string;
  academicGroupId: string;
  activatedBy: string;
  activatedAt: Date | string;
  revokedBy: string | null;
  revokedAt: Date | string | null;

  constructor({
    id,
    teacherId,
    subjectId,
    academicGroupId,
    activatedBy,
    activatedAt,
    revokedBy = null,
    revokedAt = null,
  }: {
    id: string;
    teacherId: string;
    subjectId: string;
    academicGroupId: string;
    activatedBy: string;
    activatedAt: Date | string;
    revokedBy?: string | null;
    revokedAt?: Date | string | null;
  }) {
    this.id = id;
    this.teacherId = teacherId;
    this.subjectId = subjectId;
    this.academicGroupId = academicGroupId;
    this.activatedBy = activatedBy;
    this.activatedAt = activatedAt;
    this.revokedBy = revokedBy;
    this.revokedAt = revokedAt;
  }

  toJSON(): {
    id: string;
    teacher_id: string;
    subject_id: string;
    academic_group_id: string;
    activated_by: string;
    activated_at: string;
    revoked_by: string | null;
    revoked_at: string | null;
  } {
    return {
      id: this.id,
      teacher_id: this.teacherId,
      subject_id: this.subjectId,
      academic_group_id: this.academicGroupId,
      activated_by: this.activatedBy,
      activated_at: new Date(this.activatedAt).toISOString(),
      revoked_by: this.revokedBy,
      revoked_at: this.revokedAt === null ? null : new Date(this.revokedAt).toISOString(),
    };
  }
}
