INSERT INTO permissions (permission, enforced) VALUES
  ('oral-surgery-drafts:close', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('teacher', 'oral-surgery-drafts:close')
ON CONFLICT (role, permission) DO NOTHING;
