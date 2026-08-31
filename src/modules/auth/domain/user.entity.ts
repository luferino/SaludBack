/**
 * User aggregate root. Plain entity with no dependencies so it stays
 * trivially testable; repositories map rows to and from this shape.
 */
export class User {
  id: string | null;
  username: string;
  passwordHash: string;
  role: string;
  email: string | null;
  createdAt: Date | string | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: Date | string | null;

  constructor({
    id = null,
    username,
    passwordHash,
    role,
    email = null,
    createdAt = null,
    createdBy = null,
    updatedBy = null,
    updatedAt = null,
  }: {
    id?: string | null;
    username: string;
    passwordHash: string;
    role: string;
    email?: string | null;
    createdAt?: Date | string | null;
    createdBy?: string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  } = {} as {
    id?: string | null;
    username: string;
    passwordHash: string;
    role: string;
    email?: string | null;
    createdAt?: Date | string | null;
    createdBy?: string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  }) {
    this.id = id;
    this.username = username;
    this.passwordHash = passwordHash;
    this.role = role;
    this.email = email;
    this.createdAt = createdAt;
    this.createdBy = createdBy;
    this.updatedBy = updatedBy;
    this.updatedAt = updatedAt;
  }

  /** Builds a new (not yet persisted) user. */
  static create({
    username,
    passwordHash,
    role,
    email = null,
  }: {
    username: string;
    passwordHash: string;
    role: string;
    email?: string | null;
  }): User {
    return new User({ username, passwordHash, role, email });
  }

  /**
   * Serializes the user for API responses with an explicit whitelist:
   * the password hash and every audit column (created_by/updated_by/
   * updated_at — UAC-001, AUD-002) are internal bookkeeping and never
   * leave the entity. `createdAt` stays part of the public contract.
   */
  toJSON(): {
    id: string | null;
    username: string;
    role: string;
    email: string | null;
    createdAt: Date | string | null;
  } {
    return {
      id: this.id,
      username: this.username,
      role: this.role,
      email: this.email,
      createdAt: this.createdAt,
    };
  }
}
