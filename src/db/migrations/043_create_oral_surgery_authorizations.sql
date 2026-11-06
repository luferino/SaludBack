-- Instructor paper-consent verification and surgical authorization for one exact clinical version.
ALTER TABLE oral_surgery_consent_declarations ADD CONSTRAINT oral_surgery_consent_id_draft_unique UNIQUE (id, draft_id);
CREATE TABLE oral_surgery_authorizations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES oral_surgery_drafts(id),
  draft_version BIGINT NOT NULL CHECK (draft_version > 0),
  consent_declaration_id BIGINT NOT NULL,
  reviewed_content JSONB NOT NULL CHECK (jsonb_typeof(reviewed_content) = 'object'),
  authorized_by UUID NOT NULL REFERENCES users(id),
  teacher_habilitation_id UUID NOT NULL REFERENCES teacher_academic_habilitations(id),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (consent_declaration_id, draft_id) REFERENCES oral_surgery_consent_declarations(id, draft_id)
);
CREATE INDEX oral_surgery_authorization_draft_idx ON oral_surgery_authorizations(draft_id, id);
CREATE FUNCTION preserve_oral_surgery_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'oral surgery authorization is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER oral_surgery_authorization_immutable BEFORE UPDATE ON oral_surgery_authorizations
  FOR EACH ROW EXECUTE FUNCTION preserve_oral_surgery_authorization();
