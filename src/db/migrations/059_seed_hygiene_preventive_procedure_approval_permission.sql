INSERT INTO permissions (permission, enforced) VALUES ('hygiene-preventive-drafts:approve', true)
ON CONFLICT (permission) DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('teacher', 'hygiene-preventive-drafts:approve')
ON CONFLICT (role, permission) DO NOTHING;
