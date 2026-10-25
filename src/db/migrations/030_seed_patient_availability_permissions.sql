INSERT INTO permissions (permission, enforced) VALUES
  ('patient-availabilities:manage', true),
  ('patient-availabilities:read', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'patient-availabilities:manage'),
  ('teacher', 'patient-availabilities:read')
ON CONFLICT (role, permission) DO NOTHING;
