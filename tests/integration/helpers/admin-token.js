/**
 * Shared token fixtures for the protected-route suites. Every protected
 * suite (auth/students/teachers/patients + wiring) mounts authenticate +
 * a policy guard (PermissionGuard), so requests need a REAL signed token
 * from a REAL admin row in the test DB. This mirrors the existing
 * actor-fixture pattern (INSERT a users row, sign with JwtTokenService)
 * used by the older authenticate tests.
 */
import config from '../../../src/config.ts';
import { JwtTokenService } from '../../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { PgPermissionMatrixRepository } from '../../../src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts';

export const ADMIN_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function tokenService() {
  return new JwtTokenService({
    secret: config.jwtSecret,
    secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets,
    expiresIn: config.jwtExpiresIn,
  });
}

/** Ensures one admin user exists and returns a signed admin token for it. */
export async function seedAdmin(pool) {
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_ID]);
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [ADMIN_ID, 'ADMINBOOT', 'not-a-real-hash', 'admin'],
  );
  const matrixReader = new PgPermissionMatrixRepository(pool);
  const permissions = await matrixReader.permissionsForRole('admin');
  const token = await tokenService().sign({
    sub: ADMIN_ID,
    username: 'ADMINBOOT',
    role: 'admin',
    // Derive from the seeded role_permissions (PG-003) so the admin token
    // carries every granted permission, including profile:read for GET /auth/me.
    permissions,
  });
  return { id: ADMIN_ID, token };
}

/**
 * Signs a token for an arbitrary role (non-admin callers for the 403
 * cases). The `sub` is intentionally NOT a queryable user id: a 40-char
 * non-UUID string. Endpoints that load the account by subject must
 * reject it BEFORE the DB read (a Postgres uuid cast would raise 22P02).
 * Guard-level 403 tests never reach the use case; the GET /auth/me
 * non-UUID test relies on this malformed sub on purpose (PR-002:
 * malformed identity must answer 401, no read, never 500).
 */
export async function tokenForRole(role) {
  return tokenService().sign({
    sub: 'non-admin-id-0000-0000-0000-000000000000',
    username: 'NONADMIN',
    role,
    permissions: ['profile:read'],
  });
}

/**
 * Signs an ALREADY-EXPIRED token for a role. Verification still resolves
 * the secret by kid, so the only failure is expiry — proves protected
 * routes reject expired tokens with 401 even when the role would pass the
 * guard (expiry is checked by authenticate, before any handler runs).
 */
export async function expiredTokenForRole(role) {
  return new JwtTokenService({
    secret: config.jwtSecret,
    secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets,
    expiresIn: -1,
  }).sign({
    sub: 'expired-0000-0000-0000-000000000000',
    username: 'EXPIREDADMIN',
    role,
    permissions: ['students:write'],
  });
}

/**
 * Signs a token with explicit role + permissions claims (PG-003
 * permission-semantics tests: "permission gate, not role gate"). The sub
 * defaults to a well-formed UUID that simply does not exist in the test
 * DB (never collides with seeded rows). Guard-level rejections never
 * reach the DB; if a wrongly permissive guard lets the request through,
 * the well-formed sub avoids a Postgres 22P02 uuid-cast error before the
 * use case runs. For clean deny-side proofs, pass a real seeded UUID sub
 * (ADMIN_ID or STAFF_ID) so the use case runs to completion when the
 * guard erroneously approves.
 */
export async function tokenForRolePermissions(
  role,
  permissions,
  sub = '00000000-0000-0000-0000-000000000001',
) {
  return tokenService().sign({
    sub,
    username: 'NONADMIN',
    role,
    permissions,
  });
}

/** UUID of the seeded non-admin account used by the allow-side permission tests. */
export const STAFF_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

/**
 * Seeds a real non-admin user row and returns a signed token for it
 * carrying the given permissions. The subject is a queryable UUID backed
 * by an actual row, so permission-allowed requests reach the use case and
 * any `created_by` write satisfies the FK (PG-003 allow-side proof).
 */
export async function seedUserWithPermissions(pool, { role = 'estudiante', permissions = [] } = {}) {
  // Idempotent re-seed: clear the actor's leftovers before the row itself.
  // The profile rows it created (students/teachers/patients created_by) and
  // the child user rows stamped with it (users.created_by) must go first:
  // users.created_by -> users.id is a self-FK and the profile tables'
  // created_by/user_id FKs would reject the DELETE of a referenced row.
  // Mirrors cleanDb's profile-tables-before-users order (AUD-001). The
  // username is only ever inserted with STAFF_ID, so id alone scopes the
  // user-row delete.
  await pool.query('DELETE FROM students WHERE created_by = $1', [STAFF_ID]);
  await pool.query('DELETE FROM teachers WHERE created_by = $1', [STAFF_ID]);
  await pool.query('DELETE FROM patients WHERE created_by = $1', [STAFF_ID]);
  await pool.query('DELETE FROM users WHERE created_by = $1', [STAFF_ID]);
  await pool.query('DELETE FROM users WHERE id = $1', [STAFF_ID]);
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [STAFF_ID, 'STAFFBOOT', 'not-a-real-hash', role],
  );
  const token = await tokenService().sign({
    sub: STAFF_ID,
    username: 'STAFFBOOT',
    role,
    permissions,
  });
  return { id: STAFF_ID, token };
}
