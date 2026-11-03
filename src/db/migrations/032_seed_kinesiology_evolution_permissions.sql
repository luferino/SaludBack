-- Evolution permissions are explicit and independent from initial-evaluation rights.
INSERT INTO permissions (permission, enforced) VALUES
  ('kinesiology-evolutions:write', true),
  ('kinesiology-evolutions:read', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'kinesiology-evolutions:write'),
  ('estudiante', 'kinesiology-evolutions:read'),
  ('teacher', 'kinesiology-evolutions:read')
ON CONFLICT (role, permission) DO NOTHING;
