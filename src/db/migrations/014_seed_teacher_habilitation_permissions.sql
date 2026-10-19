-- Add independently delegable teacher-habilitation activation permission.
-- Initial grant preserves the administrator's access; no role bypass is used.
INSERT INTO permissions (permission, enforced) VALUES
  ('teacher-habilitations:write', true);

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'teacher-habilitations:write');
