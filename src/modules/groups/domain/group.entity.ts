export class Group {
  id: string | null;
  academicYear: number;
  curriculumSemester: number;
  name: string;
  careerId: string | null;
  createdBy: string | null;
  createdAt: Date | string | null;

  constructor({
    id = null,
    academicYear,
    curriculumSemester,
    name,
    careerId = null,
    createdBy = null,
    createdAt = null,
  }: {
    id?: string | null;
    academicYear: number;
    curriculumSemester: number;
    name: string;
    careerId?: string | null;
    createdBy?: string | null;
    createdAt?: Date | string | null;
  }) {
    this.id = id;
    this.academicYear = academicYear;
    this.curriculumSemester = curriculumSemester;
    this.name = name;
    this.careerId = careerId;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
  }

  static create({
    academicYear,
    curriculumSemester,
    name,
    careerId,
    createdBy = null,
  }: {
    academicYear: number;
    curriculumSemester: number;
    name: string;
    careerId: string;
    createdBy?: string | null;
  }): Group {
    return new Group({ academicYear, curriculumSemester, name, careerId, createdBy });
  }

  toJSON(): {
    id: string | null;
    academic_year: number;
    curriculum_semester: number;
    name: string;
    career_id: string | null;
    created_by: string | null;
    created_at: string | null;
  } {
    return {
      id: this.id,
      academic_year: this.academicYear,
      curriculum_semester: this.curriculumSemester,
      name: this.name,
      career_id: this.careerId,
      created_by: this.createdBy,
      created_at: this.createdAt === null ? null : new Date(this.createdAt).toISOString(),
    };
  }
}
