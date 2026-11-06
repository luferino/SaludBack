-- Admin-only explicit form configuration; no clinical write grant.
INSERT INTO permissions (permission, enforced) VALUES
  ('oral-surgery-subjects:read', true),
  ('oral-surgery-subjects:write', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'oral-surgery-subjects:read'),
  ('admin', 'oral-surgery-subjects:write')
ON CONFLICT (role, permission) DO NOTHING;
