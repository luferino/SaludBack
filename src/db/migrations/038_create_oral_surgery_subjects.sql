-- Explicit opt-in, independent of subject names. Existing subjects are not enabled.
-- Composite FKs keep an enabled subject in the odontology career even for direct SQL.
ALTER TABLE careers ADD CONSTRAINT careers_id_code_unique UNIQUE (id, code);

CREATE TABLE oral_surgery_subjects (
  subject_id UUID PRIMARY KEY,
  career_id UUID NOT NULL,
  career_code TEXT NOT NULL DEFAULT 'odontology' CHECK (career_code = 'odontology'),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (subject_id, career_id) REFERENCES subjects (id, career_id) ON DELETE NO ACTION,
  FOREIGN KEY (career_id, career_code) REFERENCES careers (id, code) ON DELETE NO ACTION
);
