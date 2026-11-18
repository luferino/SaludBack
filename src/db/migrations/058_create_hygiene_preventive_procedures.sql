-- Student procedure log on hygiene drafts. Entries are free text authored by the draft's student and stay
-- editable or deletable until a teacher approves them; approval columns are all null (pending) or all set (approved).
-- Approved rows are immutable through the row trigger below. TRUNCATE fires no row trigger, so integration cleanup
-- can still clear approved rows before their draft.
-- The description check mirrors the length rule only; blank and NUL checks stay in the application validation.
CREATE TABLE hygiene_preventive_procedures (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES hygiene_preventive_drafts(id),
  procedure_date DATE NOT NULL,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  author_id UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  teacher_habilitation_id UUID REFERENCES teacher_academic_habilitations(id),
  approved_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hygiene_preventive_procedure_approval_complete CHECK (
    (approved_by IS NULL AND teacher_habilitation_id IS NULL AND approved_at IS NULL)
    OR (approved_by IS NOT NULL AND teacher_habilitation_id IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE INDEX hygiene_preventive_procedures_draft_idx ON hygiene_preventive_procedures(draft_id, id);

CREATE FUNCTION preserve_hygiene_preventive_procedure_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.draft_id, NEW.author_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.draft_id, OLD.author_id, OLD.created_at) THEN
    RAISE EXCEPTION 'hygiene preventive procedure origin is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hygiene_preventive_procedure_origin_immutable BEFORE UPDATE ON hygiene_preventive_procedures
  FOR EACH ROW EXECUTE FUNCTION preserve_hygiene_preventive_procedure_origin();

CREATE FUNCTION preserve_approved_hygiene_preventive_procedure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'approved hygiene preventive procedure is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hygiene_preventive_procedure_approved_immutable BEFORE UPDATE OR DELETE ON hygiene_preventive_procedures
  FOR EACH ROW EXECUTE FUNCTION preserve_approved_hygiene_preventive_procedure();
