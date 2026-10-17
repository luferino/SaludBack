-- Add independently delegable subject catalog permissions. The initial
-- grants preserve the administrator's existing API access; other roles are
-- granted only through explicit role_permissions rows.
INSERT INTO permissions (permission, enforced) VALUES
  ('subjects:write', true),
  ('subjects:read', true);

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'subjects:write'),
  ('admin', 'subjects:read');
