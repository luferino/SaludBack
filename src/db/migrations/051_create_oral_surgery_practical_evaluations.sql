-- Append-only practical evaluation revisions. Revision 1 is the initial grade (no reason);
-- later revisions are corrections that must carry a reason. Rows are never updated or deleted
-- by the application, and grading never touches the clinical draft or operative report.
CREATE TABLE oral_surgery_practical_evaluations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES oral_surgery_drafts(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL CHECK (revision > 0),
  hand_washing SMALLINT NOT NULL CHECK (hand_washing BETWEEN 0 AND 1),
  barrier_elements SMALLINT NOT NULL CHECK (barrier_elements BETWEEN 0 AND 1),
  waste_disposal SMALLINT NOT NULL CHECK (waste_disposal BETWEEN 0 AND 1),
  clinical_table_setup SMALLINT NOT NULL CHECK (clinical_table_setup BETWEEN 0 AND 2),
  asepsis SMALLINT NOT NULL CHECK (asepsis BETWEEN 0 AND 1),
  anamnesis_questionnaire SMALLINT NOT NULL CHECK (anamnesis_questionnaire BETWEEN 0 AND 3),
  anesthetic_technique SMALLINT NOT NULL CHECK (anesthetic_technique BETWEEN 0 AND 2),
  sindesmotomy_elevators SMALLINT NOT NULL CHECK (sindesmotomy_elevators BETWEEN 0 AND 2),
  surgical_procedure SMALLINT NOT NULL CHECK (surgical_procedure BETWEEN 0 AND 3),
  curettage_suture SMALLINT NOT NULL CHECK (curettage_suture BETWEEN 0 AND 2),
  record_and_equipment SMALLINT NOT NULL CHECK (record_and_equipment BETWEEN 0 AND 1),
  relationship SMALLINT NOT NULL CHECK (relationship BETWEEN 0 AND 1),
  total SMALLINT NOT NULL CHECK (total BETWEEN 0 AND 20),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'annulled')),
  reason TEXT CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 4000),
  graded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  teacher_habilitation_id UUID NOT NULL REFERENCES teacher_academic_habilitations(id) ON DELETE RESTRICT,
  graded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT oral_surgery_practical_revision_unique UNIQUE (draft_id, revision),
  CONSTRAINT oral_surgery_practical_total CHECK (total = hand_washing + barrier_elements + waste_disposal
    + clinical_table_setup + asepsis + anamnesis_questionnaire + anesthetic_technique + sindesmotomy_elevators
    + surgical_procedure + curettage_suture + record_and_equipment + relationship),
  CONSTRAINT oral_surgery_practical_outcome CHECK (
    (total >= 15 AND outcome = 'approved') OR (total < 15 AND outcome = 'annulled')),
  CONSTRAINT oral_surgery_practical_reason_per_revision CHECK ((revision = 1) = (reason IS NULL))
);

CREATE FUNCTION protect_oral_surgery_practical_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'practical evaluation revisions are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER oral_surgery_practical_evaluation_append_only
  BEFORE UPDATE ON oral_surgery_practical_evaluations
  FOR EACH ROW EXECUTE FUNCTION protect_oral_surgery_practical_evaluation();
