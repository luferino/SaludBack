-- Add independently delegable academic group catalog permissions.
-- Initial grants preserve the administrator's group API access.
INSERT INTO permissions (permission, enforced) VALUES
  ('groups:write', true),
  ('groups:read', true);

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'groups:write'),
  ('admin', 'groups:read');
