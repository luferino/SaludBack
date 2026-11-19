-- Student and teacher access to the patient personal-data endpoints. Reception and admin do not receive these
-- permissions: they edit through their own endpoints (reception PATCH and admin PATCH /patients/:id).
INSERT INTO permissions (permission, enforced) VALUES
  ('patient-personal-data:read', true),
  ('patient-personal-data:write', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'patient-personal-data:read'),
  ('estudiante', 'patient-personal-data:write'),
  ('teacher', 'patient-personal-data:read')
ON CONFLICT (role, permission) DO NOTHING;
