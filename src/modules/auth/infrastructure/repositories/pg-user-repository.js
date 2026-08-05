import { User } from '../../domain/user.js';
import { UserRepositoryPort } from '../../application/ports.js';

const USER_COLUMNS = 'id, username, password_hash, role, created_at';

/**
 * PostgreSQL implementation of the UserRepository port.
 * Receives a `pg` Pool (or any duck-typed `{ query }`) via constructor
 * injection so tests can pass a fake pool.
 */
export class PgUserRepository extends UserRepositoryPort {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async findByUsername(username) {
    const { rows } = await this.pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
      [username],
    );
    return rows.length === 0 ? null : rowToUser(rows[0]);
  }

  async create(user) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [user.username, user.passwordHash, user.role],
    );
    return rowToUser(rows[0]);
  }
}

function rowToUser(row) {
  return new User({
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
  });
}
