CREATE TABLE oral_surgery_operative_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL UNIQUE REFERENCES oral_surgery_drafts(id) ON DELETE RESTRICT,
  draft_version BIGINT NOT NULL CHECK (draft_version > 0),
  authorization_id BIGINT NOT NULL REFERENCES oral_surgery_authorizations(id) ON DELETE RESTRICT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'closed')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  closed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  teacher_habilitation_id UUID REFERENCES teacher_academic_habilitations(id) ON DELETE RESTRICT,
  CONSTRAINT oral_surgery_report_close_audit CHECK (
    (status = 'draft' AND closed_by IS NULL AND closed_at IS NULL AND teacher_habilitation_id IS NULL)
    OR (status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND teacher_habilitation_id IS NOT NULL)
  )
);
CREATE INDEX oral_surgery_operative_reports_authorization_idx ON oral_surgery_operative_reports(authorization_id);

CREATE FUNCTION protect_closed_oral_surgery_clinical_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.content, NEW.version, NEW.plan_revision) IS DISTINCT FROM
     ROW(OLD.content, OLD.version, OLD.plan_revision)
     AND EXISTS (SELECT 1 FROM oral_surgery_operative_reports r
                 WHERE r.draft_id = OLD.id AND r.status = 'closed') THEN
    RAISE EXCEPTION 'closed oral surgery encounter is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER oral_surgery_closed_clinical_content_immutable
  BEFORE UPDATE ON oral_surgery_drafts FOR EACH ROW EXECUTE FUNCTION protect_closed_oral_surgery_clinical_content();

CREATE FUNCTION protect_oral_surgery_operative_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed'
     OR ROW(NEW.id, NEW.draft_id, NEW.created_by, NEW.created_at, NEW.version)
        IS DISTINCT FROM ROW(OLD.id, OLD.draft_id, OLD.created_by, OLD.created_at, OLD.version + 1)
     OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'operative report is immutable or version did not advance' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
    IF NEW.closed_by IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.teacher_habilitation_id IS NOT NULL THEN
      RAISE EXCEPTION 'draft report cannot set closure audit fields' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status = 'closed' THEN
    IF ROW(NEW.draft_version, NEW.authorization_id, NEW.content)
         IS DISTINCT FROM ROW(OLD.draft_version, OLD.authorization_id, OLD.content)
       OR NEW.closed_by IS NULL OR NEW.closed_at IS NULL OR NEW.teacher_habilitation_id IS NULL THEN
      RAISE EXCEPTION 'closure cannot alter operative content or authorization' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid operative report transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER oral_surgery_operative_report_immutable
  BEFORE UPDATE ON oral_surgery_operative_reports
  FOR EACH ROW EXECUTE FUNCTION protect_oral_surgery_operative_report();
