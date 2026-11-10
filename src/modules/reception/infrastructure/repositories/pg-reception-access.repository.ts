import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { User } from '../../../auth/domain/user.entity.js';
import { PgUserRepository } from '../../../auth/infrastructure/repositories/pg-user.repository.js';
import type { ReceptionAccessRepository, ReceptionCareerGrant, ReceptionAccountSearch, ReceptionAccountSummary } from '../../application/reception.ports.js';
import type { Queryable } from '../../../shared/application/unit-of-work.js';

interface GrantRow {
  id: string; user_id: string; career_code: string; granted_by: string; granted_at: Date | string;
  revoked_by: string | null; revoked_at: Date | string | null;
}
const GRANT_COLUMNS = 'g.id, g.user_id, c.code AS career_code, g.granted_by, g.granted_at, g.revoked_by, g.revoked_at';

/** PostgreSQL repository for narrow Reception identities and audited career scopes. */
export class PgReceptionAccessRepository implements ReceptionAccessRepository {
  constructor(private readonly pool: Pool, private readonly users = new PgUserRepository(pool)) {}

  createAccount(user: User): Promise<User> { return this.users.create(user); }

  async searchAccounts(input: ReceptionAccountSearch): Promise<ReceptionAccountSummary[]> {
    const { rows } = await this.pool.query<ReceptionAccountSummary>(
      `SELECT u.id, u.username, u.email,
         ARRAY(SELECT c.code FROM reception_career_grants g JOIN careers c ON c.id = g.career_id
               WHERE g.user_id = u.id AND g.revoked_at IS NULL ORDER BY c.code) AS active_careers
       FROM users u
       WHERE u.role = 'reception'
         AND ($1::text IS NULL OR strpos(lower(u.username), lower($1)) > 0
              OR strpos(lower(u.email), lower($1)) > 0)
         AND ($2::text IS NULL OR EXISTS (
           SELECT 1 FROM reception_career_grants g JOIN careers c ON c.id = g.career_id
           WHERE g.user_id = u.id AND g.revoked_at IS NULL AND c.code = $2))
       ORDER BY u.username, u.id LIMIT $3 OFFSET $4`,
      [input.q ?? null, input.career ?? null, input.limit, input.offset]);
    return rows;
  }

  async listGrants(userId: string, activeOnly = false): Promise<ReceptionCareerGrant[]> {
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS} FROM reception_career_grants g JOIN careers c ON c.id = g.career_id
       WHERE g.user_id = $1 ${activeOnly ? 'AND g.revoked_at IS NULL' : ''}
       ORDER BY g.granted_at, g.id`, [userId]);
    return rows.map(mapGrant);
  }

  async grantCareer(userId: string, careerCode: string, actorId: string): Promise<ReceptionCareerGrant> {
    try {
      const { rows } = await this.pool.query<GrantRow>(
        `INSERT INTO reception_career_grants (user_id, career_id, granted_by, granted_at)
         SELECT $1, c.id, $3, clock_timestamp() FROM careers c
         JOIN users u ON u.id = $1 AND u.role = 'reception' WHERE c.code = $2
         RETURNING id, user_id, (SELECT code FROM careers WHERE id = career_id) AS career_code,
                   granted_by, granted_at, revoked_by, revoked_at`, [userId, careerCode, actorId]);
      if (!rows.length) throw new NotFoundError('career was not found');
      return mapGrant(rows[0]);
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'reception_career_grants_one_active') throw new ConflictError('career grant is already active');
      if (e.code === '23503') throw new NotFoundError('Reception account was not found');
      throw error;
    }
  }

  async revokeGrant(grantId: string, actorId: string): Promise<ReceptionCareerGrant> {
    const { rows } = await this.pool.query<GrantRow>(
      `UPDATE reception_career_grants
       SET revoked_by = CASE WHEN revoked_at IS NULL THEN $2 ELSE revoked_by END,
           revoked_at = CASE WHEN revoked_at IS NULL THEN GREATEST(clock_timestamp(), granted_at) ELSE revoked_at END
       WHERE id = $1
       RETURNING id, user_id, (SELECT code FROM careers WHERE id = career_id) AS career_code,
                 granted_by, granted_at, revoked_by, revoked_at`, [grantId, actorId]);
    if (!rows.length) throw new NotFoundError('career grant was not found');
    return mapGrant(rows[0]);
  }

  /**
   * Lock order for future patient operations: begin transaction, lock the Reception user
   * row, verify the active career grant, then lock patient rows. Revocation updates
   * grants without taking the user lock; this method locks the grant row after the
   * user row, so grant revocation and scoped mutations serialize on that grant row.
   */
  async withActiveCareerScope<T>(userId: string, careerCode: string, work: (client: Queryable) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      // READ COMMITTED rechecks a grant changed while waiting for its row lock.
      // No callback replay is necessary (or safe) after a concurrent revocation.
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const account = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'reception' FOR UPDATE", [userId]);
      if (!account.rows.length) throw new NotFoundError('Reception account was not found');
      const { rows } = await client.query(
        `SELECT g.id FROM reception_career_grants g JOIN careers c ON c.id = g.career_id
         WHERE g.user_id = $1 AND c.code = $2 AND g.revoked_at IS NULL FOR UPDATE OF g`, [userId, careerCode]);
      if (!rows.length) throw new NotFoundError('active career scope was not found');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

function mapGrant(row: GrantRow): ReceptionCareerGrant {
  return { id: row.id, userId: row.user_id, careerCode: row.career_code, grantedBy: row.granted_by,
    grantedAt: row.granted_at, revokedBy: row.revoked_by, revokedAt: row.revoked_at };
}
