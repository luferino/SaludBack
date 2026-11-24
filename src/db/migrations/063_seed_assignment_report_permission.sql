INSERT INTO permissions (permission, enforced)
VALUES ('assignment-reports:read', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission)
VALUES ('admin', 'assignment-reports:read')
ON CONFLICT (role, permission) DO NOTHING;
