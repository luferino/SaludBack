import type { Pool } from 'pg';
import type { PermissionMatrixReader } from '../../application/auth.ports.js';

/**
 * PostgreSQL implementation of the PermissionMatrixReader port: a PK-prefix
 * point query over the seeded `role_permissions` grants (PG-001) for the
 * given role, ordered by permission for a deterministic claim/context set.
 * Unknown roles and roles without grants resolve to `[]` (the guards answer
 * 403); only thrown errors are failures (fail closed → 500).
 * Receives a `pg` Pool (or any duck-typed `{ query }`) via constructor
 * injection so tests can pass a fake pool (house pattern from
 * PgUserRepository).
 */
export class PgPermissionMatrixRepository implements PermissionMatrixReader {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async permissionsForRole(role: string): Promise<readonly string[]> {
    const { rows } = await this.pool.query<{ permission: string }>(
      'SELECT permission FROM role_permissions WHERE role = $1 ORDER BY permission',
      [role],
    );
    return rows.map((row) => row.permission);
  }
}