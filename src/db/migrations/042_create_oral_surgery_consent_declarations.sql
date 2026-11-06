-- Paper-consent attestations, not electronic patient signatures.
ALTER TABLE oral_surgery_drafts ADD COLUMN plan_revision BIGINT NOT NULL DEFAULT 1 CHECK (plan_revision > 0);
CREATE FUNCTION advance_oral_surgery_plan_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.plan_revision := OLD.plan_revision;
  IF (NEW.content -> 'treatment_plan') IS DISTINCT FROM (OLD.content -> 'treatment_plan') THEN
    NEW.plan_revision := OLD.plan_revision + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER oral_surgery_plan_revision_before_update BEFORE UPDATE ON oral_surgery_drafts
  FOR EACH ROW EXECUTE FUNCTION advance_oral_surgery_plan_revision();

CREATE TABLE oral_surgery_consent_declarations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES oral_surgery_drafts(id),
  draft_version BIGINT NOT NULL CHECK (draft_version > 0),
  plan_revision BIGINT NOT NULL CHECK (plan_revision > 0),
  treatment_plan JSONB NOT NULL,
  declared_by UUID NOT NULL REFERENCES users(id),
  declared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX oral_surgery_consent_draft_idx ON oral_surgery_consent_declarations(draft_id, id);
CREATE FUNCTION preserve_oral_surgery_consent_declaration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'oral surgery consent declaration is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER oral_surgery_consent_declaration_immutable BEFORE UPDATE ON oral_surgery_consent_declarations
  FOR EACH ROW EXECUTE FUNCTION preserve_oral_surgery_consent_declaration();
