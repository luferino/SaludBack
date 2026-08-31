-- Additive migration: uniform audit columns on users/patients plus the
-- students/teachers profile tables (multi-role schema). Lexical after 003.
--
-- Audit convention (AUD-001): business tables carry
-- created_by (nullable FK users.id), created_at (NOT NULL default now()),
-- updated_by (nullable FK users.id), updated_at (nullable, no default).
-- `password_reset_tokens` stays exempt (only created_at). UUID PKs kept;
-- `patients` is NOT renamed. No backfill: legacy rows keep NULL audit
-- actors. Creation flows leave both updated_* columns NULL.

ALTER TABLE users
  ADD COLUMN created_by UUID REFERENCES users(id),
  ADD COLUMN updated_by UUID REFERENCES users(id),
  ADD COLUMN updated_at TIMESTAMPTZ;

ALTER TABLE patients
  ADD COLUMN updated_by UUID REFERENCES users(id),
  ADD COLUMN updated_at TIMESTAMPTZ;

-- students: profile row for role `estudiante` (alta en uno / link).
-- codalumno is globally unique case-insensitively (STU-003) and must be
-- pure ASCII alphanumeric, enforced both here and by the use case.
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  codalumno TEXT NOT NULL,
  email TEXT,
  celular TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  CONSTRAINT codalumno_format CHECK (codalumno ~ '^[A-Za-z0-9]+$')
);

CREATE UNIQUE INDEX students_codalumno_unique ON students (lower(codalumno));
CREATE INDEX students_user_id_idx ON students (user_id);

-- teachers: profile row for role `teacher` (same shape minus codalumno).
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  email TEXT,
  celular TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ
);

CREATE INDEX teachers_user_id_idx ON teachers (user_id);