import type { Pool } from 'pg';
import type { PermissionMatrixReader } from '../../application/auth.ports.js';
import type { PermissionMatrixSnapshot, PermissionMatrixSnapshotReader } from '../../application/permission-matrix-snapshot.ports.js';

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
export class PgPermissionMatrixRepository implements PermissionMatrixReader, PermissionMatrixSnapshotReader {
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

  async readSnapshot(): Promise<PermissionMatrixSnapshot> {
    const { rows } = await this.pool.query<{ permission: string; enforced: boolean; role: string | null }>(
      `SELECT p.permission, p.enforced, rp.role
       FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission = p.permission
       ORDER BY p.permission, rp.role`,
    );
    const permissions = new Map<string, { permission: string; enforced: boolean }>();
    const roles = new Map<string, string[]>();
    for (const row of rows) {
      permissions.set(row.permission, { permission: row.permission, enforced: row.enforced });
      if (row.role !== null) {
        const assigned = roles.get(row.role) ?? [];
        assigned.push(row.permission);
        roles.set(row.role, assigned);
      }
    }
    return {
      permissions: [...permissions.values()],
      roles: [...roles]
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([role, assigned]) => ({ role, permissions: assigned })),
    };
  }
}
