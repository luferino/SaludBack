-- Add independently delegable teacher-habilitation revocation permission.
-- Initial grant is admin-only; authorization remains permission-matrix based.
INSERT INTO permissions (permission, enforced) VALUES
  ('teacher-habilitations:revoke', true);

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'teacher-habilitations:revoke');
