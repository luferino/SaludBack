-- Career catalog read capability, enforced independently of subjects:read.
-- Initial grants mirror the roles that hold subjects:read (today: admin only).
INSERT INTO permissions (permission, enforced) VALUES
  ('careers:read', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'careers:read')
ON CONFLICT (role, permission) DO NOTHING;
