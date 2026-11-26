-- Split availability reads from modification while preserving every existing manage grant.
INSERT INTO permissions (permission, enforced)
VALUES('reception:availability:read', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission)
SELECT role, 'reception:availability:read'
FROM role_permissions
WHERE permission = 'reception:availability:manage'
ON CONFLICT (role, permission) DO NOTHING;
