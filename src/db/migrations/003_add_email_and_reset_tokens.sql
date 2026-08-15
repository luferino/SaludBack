-- Additive migration: users.email (nullable, unique) and password_reset_tokens.
-- Legacy rows keep email = NULL; no backfill (no join key links users to patients).
-- Multiple NULL emails are allowed by the unique index (PostgreSQL semantics).

ALTER TABLE users ADD COLUMN email TEXT;

CREATE UNIQUE INDEX users_email_unique ON users (email);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);
