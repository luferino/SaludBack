INSERT INTO permissions (permission, enforced) VALUES
  ('endodontics-drafts:read', true),
  ('endodontics-drafts:write', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'endodontics-drafts:read'),
  ('estudiante', 'endodontics-drafts:write'),
  ('teacher', 'endodontics-drafts:read'),
  ('admin', 'endodontics-drafts:read')
ON CONFLICT (role, permission) DO NOTHING;
