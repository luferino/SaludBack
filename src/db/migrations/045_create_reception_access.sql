-- Narrow Reception access. Grants are historical periods; the partial unique
-- index permits a later re-grant while preventing overlapping active periods.
CREATE TABLE reception_career_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  career_id UUID NOT NULL REFERENCES careers(id) ON DELETE RESTRICT,
  granted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT reception_grant_audit_pair CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX reception_career_grants_one_active
  ON reception_career_grants (user_id, career_id) WHERE revoked_at IS NULL;
CREATE INDEX reception_career_grants_user_history
  ON reception_career_grants (user_id, granted_at, id);

INSERT INTO permissions (permission, enforced) VALUES
  ('reception:accounts:write', true),
  ('reception:careers:write', true),
  ('reception:careers:read', true);
INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'reception:accounts:write'),
  ('admin', 'reception:careers:write'),
  ('admin', 'reception:careers:read'),
  ('reception', 'profile:read'),
  ('reception', 'reception:careers:read');
