import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Queryable } from '../../../shared/application/unit-of-work.js';
import type { RoleGrantRepository, StudentRoleCandidate, UserRoleGrant } from '../../application/active-role.ports.js';

interface GrantRow {
  id: string; user_id: string; role: 'reception'; granted_by: string; granted_at: Date | string;
  revoked_by: string | null; revoked_at: Date | string | null;
}
const COLUMNS = 'id, user_id, role, granted_by, granted_at, revoked_by, revoked_at';
const STUDENT_ROLES = "('estudiante', 'student')";

/** PostgreSQL persistence for the additional, predefined Reception membership. */
export class PgRoleGrantRepository implements RoleGrantRepository {
  constructor(private readonly pool: Pool) {}

  async searchStudentCandidates(input: { q: string; limit: number; offset: number }): Promise<StudentRoleCandidate[]> {
    const { rows } = await this.pool.query<StudentRoleCandidate>(
      `SELECT id, username, email FROM users
       WHERE role IN ${STUDENT_ROLES}
         AND (strpos(lower(username), lower($1)) > 0 OR strpos(lower(email), lower($1)) > 0)
       ORDER BY username, id LIMIT $2 OFFSET $3`, [input.q, input.limit, input.offset]);
    return rows;
  }

  async listReceptionRoleGrants(userId: string): Promise<UserRoleGrant[]> {
    const account = await this.pool.query<{ id: string }>(`SELECT id FROM users WHERE id=$1 AND role IN ${STUDENT_ROLES}`, [userId]);
    if (!account.rows.length) throw new NotFoundError('Student account was not found');
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT ${COLUMNS} FROM user_role_grants WHERE user_id=$1 AND role='reception' ORDER BY granted_at, id`, [userId]);
    return rows.map(mapGrant);
  }

  async grantReceptionRole(userId: string, actorId: string): Promise<UserRoleGrant> {
    return this.transaction(async client => {
      const account = await client.query(`SELECT id FROM users WHERE id=$1 AND role IN ${STUDENT_ROLES} FOR UPDATE`, [userId]);
      if (!account.rows.length) throw new NotFoundError('Student account was not found');
      try {
        const { rows } = await client.query<GrantRow>(
          `INSERT INTO user_role_grants (user_id, role, granted_by, granted_at)
           VALUES ($1, 'reception', $2, clock_timestamp()) RETURNING ${COLUMNS}`, [userId, actorId]);
        return mapGrant(rows[0]);
      } catch (error) {
        const e = error as { code?: string; constraint?: string };
        if (e.code === '23505' && e.constraint === 'user_role_grants_one_active') throw new ConflictError('Reception role is already active');
        if (e.code === '23503') throw new NotFoundError('Student account or grant actor was not found');
        throw error;
      }
    });
  }

  async revokeReceptionRoleGrant(grantId: string, actorId: string): Promise<UserRoleGrant> {
    return this.transaction(async client => {
      // Discover the owner without locking, then take locks in the global user -> role -> career order.
      const located = await client.query<{ user_id: string }>(
        `SELECT user_id FROM user_role_grants WHERE id=$1 AND role='reception'`, [grantId]);
      if (!located.rows.length) throw new NotFoundError('Reception role grant was not found');
      const userId = located.rows[0].user_id;
      const account = await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [userId]);
      if (!account.rows.length) throw new NotFoundError('Student account was not found');
      const { rows } = await client.query<GrantRow>(
        `SELECT ${COLUMNS} FROM user_role_grants WHERE id=$1 AND user_id=$2 AND role='reception' FOR UPDATE`, [grantId, userId]);
      if (!rows.length) throw new NotFoundError('Reception role grant was not found');
      const current = rows[0];
      if (current.revoked_at === null) {
        const revoked = await client.query<GrantRow>(
          `UPDATE user_role_grants SET revoked_by=$2, revoked_at=GREATEST(clock_timestamp(), granted_at)
           WHERE id=$1 AND revoked_at IS NULL RETURNING ${COLUMNS}`, [grantId, actorId]);
        await client.query(
          `UPDATE reception_career_grants SET revoked_by=$2, revoked_at=GREATEST(clock_timestamp(), granted_at)
           WHERE user_id=$1 AND revoked_at IS NULL`, [userId, actorId]);
        return mapGrant(revoked.rows[0]);
      }
      // Replays preserve the exact role-grant audit and never touch newer careers.
      return mapGrant(current);
    });
  }

  async availableRoles(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ role: string; has_reception: boolean }>(
      `SELECT u.role, CASE WHEN u.role IN ${STUDENT_ROLES} THEN EXISTS (
         SELECT 1 FROM user_role_grants g WHERE g.user_id=u.id AND g.role='reception' AND g.revoked_at IS NULL
       ) ELSE false END AS has_reception FROM users u WHERE u.id=$1`, [userId]);
    if (!rows.length) throw new NotFoundError('User was not found');
    return rows[0].has_reception ? [rows[0].role, 'reception'] : [rows[0].role];
  }

  async activeReceptionRoleGrant(userId: string): Promise<UserRoleGrant | null> {
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT g.${COLUMNS.replaceAll(', ', ', g.')} FROM user_role_grants g JOIN users u ON u.id=g.user_id
       WHERE g.user_id=$1 AND u.role IN ${STUDENT_ROLES} AND g.role='reception' AND g.revoked_at IS NULL`, [userId]);
    return rows.length ? mapGrant(rows[0]) : null;
  }

  async isValidActiveRole(userId: string, role: string, grantId?: string): Promise<boolean> {
    if (grantId === undefined) {
      const { rows } = await this.pool.query<{ valid: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM users WHERE id=$1 AND role=$2) AS valid', [userId, role]);
      return rows[0]?.valid === true;
    }
    if (role !== 'reception') return false;
    const { rows } = await this.pool.query<{ valid: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM users u JOIN user_role_grants g ON g.user_id=u.id
       WHERE u.id=$1 AND u.role IN ${STUDENT_ROLES} AND g.id=$2 AND g.role='reception' AND g.revoked_at IS NULL) AS valid`, [userId, grantId]);
    return rows[0]?.valid === true;
  }

  async hasActiveReceptionRoleGrant(userId: string, grantId?: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM user_role_grants WHERE user_id=$1 AND role='reception' AND revoked_at IS NULL
       ${grantId === undefined ? '' : 'AND id=$2'}) AS present`, grantId === undefined ? [userId] : [userId, grantId]);
    return rows[0]?.present === true;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

function mapGrant(row: GrantRow): UserRoleGrant {
  return { id: row.id, userId: row.user_id, role: row.role, grantedBy: row.granted_by,
    grantedAt: row.granted_at, revokedBy: row.revoked_by, revokedAt: row.revoked_at };
}
