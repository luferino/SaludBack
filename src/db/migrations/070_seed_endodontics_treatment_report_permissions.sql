-- Writes and reads of treatment reports reuse endodontics-drafts:write and endodontics-drafts:read through the draft
-- context. Only closing is new: a teacher closes a report in the draft's own subject/group; no other role receives it.
INSERT INTO permissions (permission, enforced) VALUES
  ('endodontics-treatment-reports:close', true)
ON CONFLICT (permission) DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  ('teacher', 'endodontics-treatment-reports:close')
ON CONFLICT (role, permission) DO NOTHING;
