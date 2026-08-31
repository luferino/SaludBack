/**
 * Teacher aggregate root (profile row for the `teacher` role). Plain
 * entity with no dependencies so it stays trivially testable;
 * repositories map rows to and from this shape. Mirrors Student minus
 * `codalumno` (teachers have no student code — TEA-001).
 */
export class Teacher {
  id: string | null;
  userId: string | null;
  nombres: string;
  apellidos: string;
  email: string | null;
  celular: string | null;
  createdBy: string | null;
  createdAt: Date | string | null;
  updatedBy: string | null;
  updatedAt: Date | string | null;

  constructor({
    id = null,
    userId = null,
    nombres,
    apellidos,
    email = null,
    celular = null,
    createdBy = null,
    createdAt = null,
    updatedBy = null,
    updatedAt = null,
  }: {
    id?: string | null;
    userId?: string | null;
    nombres: string;
    apellidos: string;
    email?: string | null;
    celular?: string | null;
    createdBy?: string | null;
    createdAt?: Date | string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  } = {} as {
    id?: string | null;
    userId?: string | null;
    nombres: string;
    apellidos: string;
    email?: string | null;
    celular?: string | null;
    createdBy?: string | null;
    createdAt?: Date | string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  }) {
    this.id = id;
    this.userId = userId;
    this.nombres = nombres;
    this.apellidos = apellidos;
    this.email = email;
    this.celular = celular;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
    this.updatedBy = updatedBy;
    this.updatedAt = updatedAt;
  }

  /** Builds a new (not yet persisted) teacher. */
  static create({
    userId,
    nombres,
    apellidos,
    email = null,
    celular = null,
    createdBy = null,
  }: {
    userId: string | null;
    nombres: string;
    apellidos: string;
    email?: string | null;
    celular?: string | null;
    createdBy?: string | null;
  }): Teacher {
    return new Teacher({
      userId,
      nombres,
      apellidos,
      email,
      celular,
      createdBy,
    });
  }

  /**
   * Serializes the teacher for API responses. Explicit whitelist with
   * exactly the 7 TEA-003 contract keys; `created_by` is always present,
   * `null` when no actor recorded it. The user link (`user_id`), the
   * account credentials, and the update audit columns (`updated_by` /
   * `updated_at`, AUD-002) are internal bookkeeping and are never
   * serialized. No `codalumno` key: teachers have no student code.
   */
  toJSON(): {
    id: string | null;
    nombres: string;
    apellidos: string;
    email: string | null;
    celular: string | null;
    created_by: string | null;
    created_at: Date | string | null;
  } {
    return {
      id: this.id,
      nombres: this.nombres,
      apellidos: this.apellidos,
      email: this.email,
      celular: this.celular,
      created_by: this.createdBy ?? null,
      created_at: this.createdAt,
    };
  }
}