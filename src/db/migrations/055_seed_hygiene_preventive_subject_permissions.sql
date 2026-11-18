-- Admin-only explicit form configuration; no clinical write grant.
INSERT INTO permissions (permission, enforced) VALUES
  ('hygiene-preventive-subjects:read', true),
  ('hygiene-preventive-subjects:write', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'hygiene-preventive-subjects:read'),
  ('admin', 'hygiene-preventive-subjects:write')
ON CONFLICT (role, permission) DO NOTHING;
