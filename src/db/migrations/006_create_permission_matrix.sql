-- Schema migration: permission matrix moves into PostgreSQL as the single
-- source of truth (PG-001, user-auth deltas). `permissions` is the catalog
-- (permission + `enforced` flag); `role_permissions` holds the grants.
-- The matrix was previously pinned in src/modules/auth/domain/permissions.ts
-- (swept in the same change). A role's grants come from the PK-prefix point
-- query `SELECT permission FROM role_permissions WHERE role = $1`; the
-- PRIMARY KEY (role, permission) already indexes the leading column.
--
-- migrate.ts wraps this file in one transaction and records it once-only,
-- so a failure rolls both tables back.
--
-- Rollback: DROP TABLE role_permissions; DROP TABLE permissions;
-- (pure reference data — dropping loses no user data). Honest code-level
-- rollback must revert the sweep commit in the same unit (proposal
-- rollback plan: no partial rollback by design).
--
-- Re-apply: after a manual rollback the 006 row stays in schema_migrations;
-- `pnpm db:migrate` prints "Skipping 006 (already applied)" forever.
-- Re-applying requires deleting that row first:
--   DELETE FROM schema_migrations WHERE name = '006_create_permission_matrix.sql';

CREATE TABLE permissions (
  permission TEXT PRIMARY KEY,
  enforced BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL REFERENCES permissions(permission),
  PRIMARY KEY (role, permission)
);