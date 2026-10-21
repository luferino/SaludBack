-- Student activation is delegated to teachers but remains context-authorized
-- by an active teacher habilitation in the requested subject/group.
INSERT INTO permissions (permission, enforced)
VALUES ('student-habilitations:write', true)
ON CONFLICT (permission) DO UPDATE SET enforced = EXCLUDED.enforced;

INSERT INTO role_permissions (role, permission)
VALUES ('teacher', 'student-habilitations:write')
ON CONFLICT (role, permission) DO NOTHING;
