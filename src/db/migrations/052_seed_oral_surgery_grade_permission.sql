INSERT INTO permissions (permission, enforced) VALUES
  ('oral-surgery-drafts:grade', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('teacher', 'oral-surgery-drafts:grade')
ON CONFLICT (role, permission) DO NOTHING;
