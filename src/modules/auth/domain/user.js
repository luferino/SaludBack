/**
 * User aggregate root. Plain entity with no dependencies so it stays
 * trivially testable; repositories map rows to and from this shape.
 */
export class User {
  constructor({ id = null, username, passwordHash, role, createdAt = null } = {}) {
    this.id = id;
    this.username = username;
    this.passwordHash = passwordHash;
    this.role = role;
    this.createdAt = createdAt;
  }

  /** Builds a new (not yet persisted) user. */
  static create({ username, passwordHash, role }) {
    return new User({ username, passwordHash, role });
  }

  /**
   * Serializes the user for API responses, excluding the password hash.
   */
  toJSON() {
    const { passwordHash, ...publicUser } = this;
    return publicUser;
  }
}
