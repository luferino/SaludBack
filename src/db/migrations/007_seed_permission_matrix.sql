-- Seed migration: canonical matrix, mirrored from the swept ROLE_PERMISSIONS
-- constant (verified against it before deletion). Catalog: 5 enforced
-- permissions + 2 inert claims (materias:read / turnos:read, enforced=false:
-- grantable and token-bearing, never guard-enforced — PG-001). Grants:
-- estudiante/teacher -> profile:read + the two inert claims; admin -> all 7
-- (admin keeps every protected mount, PG-003, without role-specific logic).
-- Future grant changes = new seed-only migrations 008+ (one file each).
--
-- Rollback: data-only — re-seed from an earlier 007, or DROP the tables (006).
-- Re-apply: DELETE FROM schema_migrations WHERE name = '007_seed_permission_matrix.sql';

INSERT INTO permissions (permission, enforced) VALUES
  ('users:write',    true),
  ('students:write', true),
  ('teachers:write', true),
  ('patients:write', true),
  ('profile:read',   true),
  ('materias:read',  false),
  ('turnos:read',    false);

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'profile:read'),
  ('estudiante', 'materias:read'),
  ('estudiante', 'turnos:read'),
  ('teacher',    'profile:read'),
  ('teacher',    'materias:read'),
  ('teacher',    'turnos:read'),
  ('admin',      'users:write'),
  ('admin',      'students:write'),
  ('admin',      'teachers:write'),
  ('admin',      'patients:write'),
  ('admin',      'profile:read'),
  ('admin',      'materias:read'),
  ('admin',      'turnos:read');