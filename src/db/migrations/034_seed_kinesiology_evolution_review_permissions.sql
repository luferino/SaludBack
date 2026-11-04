-- Submission and review are separate capabilities; administrators receive neither implicitly.
INSERT INTO permissions (permission, enforced) VALUES
  ('kinesiology-evolutions:submit', true),
  ('kinesiology-evolutions:review', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'kinesiology-evolutions:submit'),
  ('teacher', 'kinesiology-evolutions:review')
ON CONFLICT (role, permission) DO NOTHING;
