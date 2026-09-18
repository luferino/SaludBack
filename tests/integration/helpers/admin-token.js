/**
 * Shared token fixtures for the AdminGuard era. Every protected suite
 * (auth/students/teachers/patients + wiring) mounts authenticate +
 * AdminGuard now, so requests need a REAL signed token from a REAL admin
 * row in the test DB. This mirrors the existing actor-fixture pattern
 * (INSERT a users row, sign with JwtTokenService) used by the older
 * authenticate tests.
 */
import config from '../../../src/config.ts';
import { JwtTokenService } from '../../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { ROLE_PERMISSIONS } from '../../../src/modules/auth/domain/permissions.ts';

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
  const token = await tokenService().sign({
    sub: ADMIN_ID,
    username: 'ADMINBOOT',
    role: 'admin',
    // Derive from the pinned matrix (PG-003) so the admin token carries
    // every granted permission, including profile:read for GET /auth/me.
    permissions: [...ROLE_PERMISSIONS.admin],
  });
  return { id: ADMIN_ID, token };
}

/** Signs a token for an arbitrary role (non-admin callers for the 403 cases). */
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