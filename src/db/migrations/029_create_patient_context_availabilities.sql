CREATE TABLE patient_context_availabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE NO ACTION,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE NO ACTION,
  academic_group_id UUID NOT NULL REFERENCES academic_groups(id) ON DELETE NO ACTION,
  enabled_by UUID NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  withdrawn_by UUID REFERENCES users(id) ON DELETE NO ACTION,
  withdrawn_at TIMESTAMPTZ,
  CONSTRAINT patient_context_availabilities_withdraw_pair CHECK ((withdrawn_by IS NULL) = (withdrawn_at IS NULL)),
  CONSTRAINT patient_context_availabilities_chronology CHECK (withdrawn_at IS NULL OR withdrawn_at >= enabled_at)
);
CREATE UNIQUE INDEX patient_context_availabilities_one_active
  ON patient_context_availabilities(patient_id, subject_id, academic_group_id) WHERE withdrawn_at IS NULL;
CREATE INDEX patient_context_availabilities_history_idx
  ON patient_context_availabilities(patient_id, enabled_at DESC, id DESC);
