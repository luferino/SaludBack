export class SubjectGroup {
  subjectId: string;
  academicGroupId: string;
  createdBy: string | null;
  createdAt: Date | string | null;

  constructor({
    subjectId,
    academicGroupId,
    createdBy = null,
    createdAt = null,
  }: {
    subjectId: string;
    academicGroupId: string;
    createdBy?: string | null;
    createdAt?: Date | string | null;
  }) {
    this.subjectId = subjectId;
    this.academicGroupId = academicGroupId;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
  }

  toJSON(): {
    subject_id: string;
    academic_group_id: string;
    created_by: string | null;
    created_at: string | null;
  } {
    return {
      subject_id: this.subjectId,
      academic_group_id: this.academicGroupId,
      created_by: this.createdBy,
      created_at: this.createdAt === null ? null : new Date(this.createdAt).toISOString(),
    };
  }
}
