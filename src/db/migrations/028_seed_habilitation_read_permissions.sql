-- Read grants never imply activation/revocation or waive context checks.
-- Student period reads by non-admins are restricted to live teacher contexts.
INSERT INTO permissions (permission, enforced) VALUES
  ('teacher-habilitations:read', true),
  ('student-habilitations:read', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'teacher-habilitations:read'),
  ('admin', 'student-habilitations:read'),
  ('teacher', 'student-habilitations:read')
ON CONFLICT (role, permission) DO NOTHING;
