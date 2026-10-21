INSERT INTO permissions (permission, enforced) VALUES
  ('kinesiology-evaluations:read', true),
  ('kinesiology-evaluations:write', true),
  ('kinesiology-evaluations:submit', true),
  ('kinesiology-evaluations:verify-consent', true),
  ('kinesiology-evaluations:review', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission) VALUES
  ('teacher', 'kinesiology-evaluations:read'),
  ('estudiante', 'kinesiology-evaluations:read'),
  ('estudiante', 'kinesiology-evaluations:write'),
  ('estudiante', 'kinesiology-evaluations:submit'),
  ('teacher', 'kinesiology-evaluations:verify-consent'),
  ('teacher', 'kinesiology-evaluations:review')
ON CONFLICT (role, permission) DO NOTHING;
