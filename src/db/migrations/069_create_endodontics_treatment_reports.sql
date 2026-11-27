CREATE TABLE endodontics_treatment_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL UNIQUE REFERENCES endodontics_drafts(id) ON DELETE RESTRICT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'closed')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  closed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  teacher_habilitation_id UUID REFERENCES teacher_academic_habilitations(id) ON DELETE RESTRICT,
  CONSTRAINT endodontics_treatment_report_close_audit CHECK (
    (status = 'draft' AND closed_by IS NULL AND closed_at IS NULL AND teacher_habilitation_id IS NULL)
    OR (status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND teacher_habilitation_id IS NOT NULL)
  )
);

-- A closed report is final: no update, no delete. Its diagnostic draft is locked by the trigger below.
CREATE FUNCTION protect_endodontics_treatment_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed'
     OR ROW(NEW.id, NEW.draft_id, NEW.created_by, NEW.created_at, NEW.version)
        IS DISTINCT FROM ROW(OLD.id, OLD.draft_id, OLD.created_by, OLD.created_at, OLD.version + 1)
     OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'endodontics treatment report is immutable or version did not advance' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
    IF NEW.closed_by IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.teacher_habilitation_id IS NOT NULL THEN
      RAISE EXCEPTION 'draft treatment report cannot set closure audit fields' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status = 'closed' THEN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.closed_by IS NULL OR NEW.closed_at IS NULL OR NEW.teacher_habilitation_id IS NULL THEN
      RAISE EXCEPTION 'closing cannot alter treatment report content or omit closure audit' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid endodontics treatment report transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endodontics_treatment_report_immutable
  BEFORE UPDATE ON endodontics_treatment_reports
  FOR EACH ROW EXECUTE FUNCTION protect_endodontics_treatment_report();

CREATE FUNCTION protect_closed_endodontics_treatment_report_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'closed endodontics treatment report cannot be deleted' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER endodontics_treatment_report_undeletable
  BEFORE DELETE ON endodontics_treatment_reports
  FOR EACH ROW EXECUTE FUNCTION protect_closed_endodontics_treatment_report_delete();

-- Once a report is closed, the diagnostic draft it points at cannot change content or version.
CREATE FUNCTION protect_closed_endodontics_treatment_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.content, NEW.version) IS DISTINCT FROM ROW(OLD.content, OLD.version)
     AND EXISTS (SELECT 1 FROM endodontics_treatment_reports r
                 WHERE r.draft_id = OLD.id AND r.status = 'closed') THEN
    RAISE EXCEPTION 'closed endodontics treatment report locks its diagnostic draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER endodontics_closed_treatment_draft_immutable
  BEFORE UPDATE ON endodontics_drafts
  FOR EACH ROW EXECUTE FUNCTION protect_closed_endodontics_treatment_draft();
