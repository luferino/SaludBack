-- Audited additional-role periods. This migration adds no permissions or
-- identities; the extra Reception entitlement is inert until live auth wiring.
CREATE TABLE user_role_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role = 'reception'),
  granted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT user_role_grant_audit_pair CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX user_role_grants_one_active
  ON user_role_grants (user_id, role) WHERE revoked_at IS NULL;
CREATE INDEX user_role_grants_user_history
  ON user_role_grants (user_id, granted_at, id);
