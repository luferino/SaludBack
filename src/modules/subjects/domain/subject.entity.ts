export class Subject {
  id: string | null;
  name: string;
  createdBy: string | null;
  createdAt: Date | string | null;

  constructor({
    id = null,
    name,
    createdBy = null,
    createdAt = null,
  }: {
    id?: string | null;
    name: string;
    createdBy?: string | null;
    createdAt?: Date | string | null;
  }) {
    this.id = id;
    this.name = name;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
  }

  static create({ name, createdBy = null }: { name: string; createdBy?: string | null }): Subject {
    return new Subject({ name, createdBy });
  }

  toJSON(): {
    id: string | null;
    name: string;
    created_by: string | null;
    created_at: string | null;
  } {
    return {
      id: this.id,
      name: this.name,
      created_by: this.createdBy,
      created_at: this.createdAt === null ? null : new Date(this.createdAt).toISOString(),
    };
  }
}
