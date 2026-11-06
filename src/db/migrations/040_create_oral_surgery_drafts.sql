-- Draft encounters only: no consent, submission, surgery report or grading lifecycle.
-- The (clinical_record_id, patient_id) key reuses unique index clinical_records_id_patient_unique from 031.
ALTER TABLE student_academic_habilitations ADD CONSTRAINT student_habilitations_id_context_unique
  UNIQUE (id, subject_id, academic_group_id);

CREATE TABLE oral_surgery_drafts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinical_record_id BIGINT NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  author_id UUID NOT NULL REFERENCES users(id),
  origin_student_habilitation_id UUID NOT NULL,
  origin_subject_id UUID NOT NULL REFERENCES oral_surgery_subjects(subject_id),
  origin_group_id UUID NOT NULL REFERENCES academic_groups(id),
  content JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (clinical_record_id, patient_id) REFERENCES clinical_records(id, patient_id),
  FOREIGN KEY (origin_student_habilitation_id, origin_subject_id, origin_group_id)
    REFERENCES student_academic_habilitations(id, subject_id, academic_group_id)
);
CREATE INDEX oral_surgery_drafts_patient_idx ON oral_surgery_drafts(patient_id, id);
CREATE INDEX oral_surgery_drafts_author_idx ON oral_surgery_drafts(author_id, id);
CREATE INDEX oral_surgery_drafts_context_idx ON oral_surgery_drafts(origin_subject_id, origin_group_id, id);

CREATE FUNCTION preserve_oral_surgery_draft_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.clinical_record_id, NEW.patient_id, NEW.author_id,
         NEW.origin_student_habilitation_id, NEW.origin_subject_id, NEW.origin_group_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.clinical_record_id, OLD.patient_id, OLD.author_id,
         OLD.origin_student_habilitation_id, OLD.origin_subject_id, OLD.origin_group_id, OLD.created_at) THEN
    RAISE EXCEPTION 'oral surgery draft origin is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER oral_surgery_draft_origin_immutable BEFORE UPDATE ON oral_surgery_drafts
  FOR EACH ROW EXECUTE FUNCTION preserve_oral_surgery_draft_origin();
