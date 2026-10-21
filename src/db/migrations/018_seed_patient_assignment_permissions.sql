INSERT INTO permissions (permission, enforced) VALUES
  ('patient-assignments:write', true),
  ('patient-assignments:read', true),
  ('patient-assignments:read-own', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission) VALUES
  ('teacher', 'patient-assignments:write'),
  ('teacher', 'patient-assignments:read'),
  ('estudiante', 'patient-assignments:read-own')
ON CONFLICT (role, permission) DO NOTHING;
