-- Minimal selectors are separate read capabilities, not implied by writes.
-- Teachers may select students globally, including those not yet habilitated.
INSERT INTO permissions (permission, enforced) VALUES
  ('teachers:read', true),
  ('students:read', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'teachers:read'),
  ('admin', 'students:read'),
  ('teacher', 'students:read')
ON CONFLICT (role, permission) DO NOTHING;
