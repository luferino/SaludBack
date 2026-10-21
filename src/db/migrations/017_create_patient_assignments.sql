-- Assignment history is separate from clinical records and retains exact period/audit references.
ALTER TABLE student_academic_habilitations
  ADD CONSTRAINT student_habilitations_id_subject_unique UNIQUE (id, subject_id);

CREATE TABLE patient_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE NO ACTION,
  student_habilitation_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ended_by UUID REFERENCES users(id) ON DELETE NO ACTION,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  CONSTRAINT patient_assignments_period_subject_fk
    FOREIGN KEY (student_habilitation_id, subject_id)
    REFERENCES student_academic_habilitations(id, subject_id) ON DELETE NO ACTION,
  CONSTRAINT patient_assignments_end_pair CHECK ((ended_by IS NULL) = (ended_at IS NULL)),
  CONSTRAINT patient_assignments_end_chronology CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);

CREATE UNIQUE INDEX patient_assignments_one_active_patient_subject
  ON patient_assignments(patient_id, subject_id) WHERE ended_at IS NULL;
CREATE INDEX patient_assignments_period_idx ON patient_assignments(student_habilitation_id, id);
