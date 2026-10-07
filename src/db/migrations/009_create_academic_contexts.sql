-- Schema-only academic catalog foundation. UUID keys follow the existing
-- catalog/account identity convention; clinical_records' BIGINT key is a
-- documented table-specific exception. Actor columns follow AUD-001 nullable
-- bookkeeping and reference the existing UUID user identity.
-- src/db/migrate.ts owns the per-file transaction and migration ledger.

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  CONSTRAINT subjects_name_nonblank CHECK (btrim(name) <> '')
);

CREATE TABLE academic_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year INTEGER NOT NULL,
  curriculum_semester INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  CONSTRAINT academic_groups_year_positive CHECK (academic_year > 0),
  CONSTRAINT academic_groups_curriculum_semester_positive CHECK (curriculum_semester > 0),
  CONSTRAINT academic_groups_name_nonblank CHECK (btrim(name) <> ''),
  CONSTRAINT academic_groups_year_semester_name_unique
    UNIQUE (academic_year, curriculum_semester, name)
);

CREATE TABLE subject_academic_groups (
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE NO ACTION,
  academic_group_id UUID NOT NULL REFERENCES academic_groups(id) ON DELETE NO ACTION,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, academic_group_id)
);
