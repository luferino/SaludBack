CREATE TABLE endodontics_drafts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinical_record_id BIGINT NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  author_id UUID NOT NULL REFERENCES users(id),
  origin_student_habilitation_id UUID NOT NULL,
  origin_subject_id UUID NOT NULL REFERENCES endodontics_subjects(subject_id),
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
CREATE INDEX endodontics_drafts_patient_idx ON endodontics_drafts(patient_id, id);
CREATE INDEX endodontics_drafts_author_idx ON endodontics_drafts(author_id, id);
CREATE INDEX endodontics_drafts_context_idx ON endodontics_drafts(origin_subject_id, origin_group_id, id);
CREATE FUNCTION preserve_endodontics_draft_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.clinical_record_id, NEW.patient_id, NEW.author_id, NEW.origin_student_habilitation_id,
    NEW.origin_subject_id, NEW.origin_group_id, NEW.created_at) IS DISTINCT FROM
     ROW(OLD.id, OLD.clinical_record_id, OLD.patient_id, OLD.author_id, OLD.origin_student_habilitation_id,
    OLD.origin_subject_id, OLD.origin_group_id, OLD.created_at) THEN
    RAISE EXCEPTION 'endodontics draft origin is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endodontics_draft_origin_immutable BEFORE UPDATE ON endodontics_drafts
  FOR EACH ROW EXECUTE FUNCTION preserve_endodontics_draft_origin();
