INSERT INTO permissions (permission, enforced) VALUES ('oral-surgery-drafts:authorize', true)
ON CONFLICT (permission) DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('teacher', 'oral-surgery-drafts:authorize')
ON CONFLICT (role, permission) DO NOTHING;
