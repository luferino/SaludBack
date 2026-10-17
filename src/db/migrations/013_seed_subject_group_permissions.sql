-- Add independently delegable subject-group association permissions.
-- Initial grants preserve the administrator's association API access.
INSERT INTO permissions (permission, enforced) VALUES
  ('subject-groups:write', true),
  ('subject-groups:read', true);

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'subject-groups:write'),
  ('admin', 'subject-groups:read');
