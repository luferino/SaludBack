INSERT INTO permissions (permission, enforced) VALUES
  ('hygiene-preventive-drafts:read', true),
  ('hygiene-preventive-drafts:write', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'hygiene-preventive-drafts:read'),
  ('estudiante', 'hygiene-preventive-drafts:write'),
  ('teacher', 'hygiene-preventive-drafts:read'),
  ('admin', 'hygiene-preventive-drafts:read')
ON CONFLICT (role, permission) DO NOTHING;
