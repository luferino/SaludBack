-- Careers partition subjects and academic groups. Existing subjects and groups
-- predate careers and are backfilled to kinesiology in this same migration.
-- Odontology subjects and groups are created through the API, never seeded here.
-- Same-career subject-group associations are enforced by composite keys.
-- src/db/migrate.ts owns the per-file transaction and migration ledger.

CREATE TABLE careers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT careers_name_nonblank CHECK (btrim(name) <> '')
);

INSERT INTO careers (code, name) VALUES
  ('kinesiology', 'Kinesiología'),
  ('odontology', 'Odontología');

ALTER TABLE subjects
  ADD COLUMN career_id UUID REFERENCES careers(id);
UPDATE subjects SET career_id = (SELECT id FROM careers WHERE code = 'kinesiology');
ALTER TABLE subjects ALTER COLUMN career_id SET NOT NULL;
ALTER TABLE subjects ADD CONSTRAINT subjects_id_career_unique UNIQUE (id, career_id);

ALTER TABLE academic_groups
  ADD COLUMN career_id UUID REFERENCES careers(id);
UPDATE academic_groups SET career_id = (SELECT id FROM careers WHERE code = 'kinesiology');
ALTER TABLE academic_groups ALTER COLUMN career_id SET NOT NULL;
ALTER TABLE academic_groups DROP CONSTRAINT academic_groups_year_semester_name_unique;
ALTER TABLE academic_groups
  ADD CONSTRAINT academic_groups_career_year_semester_name_unique
    UNIQUE (career_id, academic_year, curriculum_semester, name);
ALTER TABLE academic_groups ADD CONSTRAINT academic_groups_id_career_unique UNIQUE (id, career_id);

ALTER TABLE subject_academic_groups
  ADD COLUMN career_id UUID;
UPDATE subject_academic_groups AS sag SET career_id = s.career_id FROM subjects AS s WHERE s.id = sag.subject_id;
ALTER TABLE subject_academic_groups ALTER COLUMN career_id SET NOT NULL;
ALTER TABLE subject_academic_groups
  ADD CONSTRAINT subject_academic_groups_subject_career_fkey
    FOREIGN KEY (subject_id, career_id) REFERENCES subjects (id, career_id) ON DELETE NO ACTION,
  ADD CONSTRAINT subject_academic_groups_academic_group_career_fkey
    FOREIGN KEY (academic_group_id, career_id) REFERENCES academic_groups (id, career_id) ON DELETE NO ACTION;
