export class Subject {
  id: string | null;
  name: string;
  careerId: string | null;
  createdBy: string | null;
  createdAt: Date | string | null;

  constructor({
    id = null,
    name,
    careerId = null,
    createdBy = null,
    createdAt = null,
  }: {
    id?: string | null;
    name: string;
    careerId?: string | null;
    createdBy?: string | null;
    createdAt?: Date | string | null;
  }) {
    this.id = id;
    this.name = name;
    this.careerId = careerId;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
  }

  static create({ name, careerId, createdBy = null }: { name: string; careerId: string; createdBy?: string | null }): Subject {
    return new Subject({ name, careerId, createdBy });
  }

  toJSON(): {
    id: string | null;
    name: string;
    career_id: string | null;
    created_by: string | null;
    created_at: string | null;
  } {
    return {
      id: this.id,
      name: this.name,
      career_id: this.careerId,
      created_by: this.createdBy,
      created_at: this.createdAt === null ? null : new Date(this.createdAt).toISOString(),
    };
  }
}
