-- Admin-only explicit form configuration; no clinical write grant.
INSERT INTO permissions (permission, enforced) VALUES
  ('endodontics-subjects:read', true),
  ('endodontics-subjects:write', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'endodontics-subjects:read'),
  ('admin', 'endodontics-subjects:write')
ON CONFLICT (role, permission) DO NOTHING;
