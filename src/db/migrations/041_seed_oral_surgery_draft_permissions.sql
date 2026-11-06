INSERT INTO permissions (permission, enforced) VALUES
  ('oral-surgery-drafts:read', true),
  ('oral-surgery-drafts:write', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'oral-surgery-drafts:read'),
  ('estudiante', 'oral-surgery-drafts:write'),
  ('teacher', 'oral-surgery-drafts:read'),
  ('admin', 'oral-surgery-drafts:read')
ON CONFLICT (role, permission) DO NOTHING;
