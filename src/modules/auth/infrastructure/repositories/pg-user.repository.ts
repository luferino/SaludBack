import type { Pool } from 'pg';
import { User } from '../../domain/user.entity.js';
import type { UserRepositoryPort } from '../../application/auth.ports.js';
import type { Queryable } from '../../../shared/application/unit-of-work.js';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  email: string | null;
  created_at: Date | string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: Date | string | null;
}

const USER_COLUMNS =
  'id, username, password_hash, role, email, created_at, created_by, updated_by, updated_at';

/**
 * PostgreSQL implementation of the UserRepository port.
 * Receives a `pg` Pool (or any duck-typed `{ query }`) via constructor
 * injection so tests can pass a fake pool.
 */
export class PgUserRepository implements UserRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findByUsername(username: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
      [username],
    );
    return rows.length === 0 ? null : rowToUser(rows[0]);
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
      [email],
    );
    return rows.length === 0 ? null : rowToUser(rows[0]);
  }

  async create(user: User, client?: Queryable): Promise<User> {
    const db = client ?? this.pool;
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (username, password_hash, role, email, created_by, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${USER_COLUMNS}`,
      [
        user.username,
        user.passwordHash,
        user.role,
        user.email,
        user.createdBy,
        null,
        null,
      ],
    );
    return rowToUser(rows[0]);
  }

  async updatePassword(userId: string, newPasswordHash: string): Promise<void> {
    await this.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      userId,
      newPasswordHash,
    ]);
  }
}

function rowToUser(row: UserRow): User {
  return new User({
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    email: row.email,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
}
