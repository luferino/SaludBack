import { PasswordResetToken } from '../../domain/password-reset-token.js';
import { ResetTokenRepositoryPort } from '../../application/ports.js';

const TOKEN_COLUMNS = 'id, user_id, token_hash, expires_at, used_at, created_at';

/**
 * PostgreSQL implementation of the ResetTokenRepository port.
 * Receives a `pg` Pool (or any duck-typed `{ query }`) and the per-user
 * outstanding cap via constructor injection so tests can pass a fake pool.
 *
 * `create` enforces the cap (design D4) in a single atomic statement:
 * the oldest outstanding tokens beyond the newest `maxOutstanding - 1`
 * are marked used first, then the new token is inserted. Marking BEFORE
 * the insert is deliberate: WITH sub-statements in the same command share
 * the command snapshot, so an overflow scan issued after the insert
 * cannot rely on seeing the just-inserted row — the design's insert-first
 * ordering leaves the cap unenforced when verified against PostgreSQL.
 */
export class PgResetTokenRepository extends ResetTokenRepositoryPort {
  constructor(pool, maxOutstanding = 3) {
    super();
    this.pool = pool;
    this.maxOutstanding = maxOutstanding;
  }

  async create({ userId, tokenHash, expiresAt }) {
    const { rows } = await this.pool.query(
      `WITH overflow AS (
         SELECT id
         FROM password_reset_tokens
         WHERE user_id = $1 AND used_at IS NULL
         ORDER BY created_at DESC, id DESC
         OFFSET $4 - 1
       ),
       marked AS (
         UPDATE password_reset_tokens
         SET used_at = now()
         FROM overflow
         WHERE overflow.id = password_reset_tokens.id
       )
       INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING ${TOKEN_COLUMNS}`,
      [userId, tokenHash, expiresAt, this.maxOutstanding],
    );
    return rowToToken(rows[0]);
  }

  async findValidByHash(tokenHash) {
    const { rows } = await this.pool.query(
      `SELECT ${TOKEN_COLUMNS}
       FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    return rows.length === 0 ? null : rowToToken(rows[0]);
  }

  async markUsed(id) {
    await this.pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [id]);
  }
}

function rowToToken(row) {
  return new PasswordResetToken({
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  });
}
