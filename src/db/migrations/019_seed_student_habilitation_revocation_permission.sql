-- Student-period revocation is distinct from student activation.
INSERT INTO permissions (permission, enforced)
VALUES ('student-habilitations:revoke', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission)
VALUES ('teacher', 'student-habilitations:revoke')
ON CONFLICT (role, permission) DO NOTHING;
