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

  constructor({
    id = null,
    username,
    passwordHash,
    role,
    email = null,
    createdAt = null,
  }: {
    id?: string | null;
    username: string;
    passwordHash: string;
    role: string;
    email?: string | null;
    createdAt?: Date | string | null;
  } = {} as {
    id?: string | null;
    username: string;
    passwordHash: string;
    role: string;
    email?: string | null;
    createdAt?: Date | string | null;
  }) {
    this.id = id;
    this.username = username;
    this.passwordHash = passwordHash;
    this.role = role;
    this.email = email;
    this.createdAt = createdAt;
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
   * Serializes the user for API responses, excluding the password hash.
   */
  toJSON(): {
    id: string | null;
    username: string;
    role: string;
    email: string | null;
    createdAt: Date | string | null;
  } {
    const { passwordHash: _, ...publicUser } = this;
    return publicUser;
  }
}
