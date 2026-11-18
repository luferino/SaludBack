-- Paper-consent declarations on hygiene drafts: the student author attests that the signed paper exists.
-- This is not an electronic signature and no document is uploaded. Rows are append-only: the row trigger
-- rejects UPDATE and DELETE, and the statement trigger follows the clinical history guard of 053. TRUNCATE
-- fires no trigger, so integration cleanup can still clear the table.
-- A patient signer copies the patient's name and documento into the row, so the snapshot does not change
-- when the patient record changes. Patient names have no length limit and patient documento is validated only by
-- the application, so the name length and documento format checks cover parent signers only. The under-18 rule
-- depends on the declaration date and stays in the repository.
CREATE TABLE hygiene_preventive_consent_declarations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES hygiene_preventive_drafts(id),
  signer TEXT NOT NULL CHECK (signer IN ('patient', 'parent')),
  signer_name TEXT NOT NULL CHECK (char_length(signer_name) >= 1
    AND (signer = 'patient' OR char_length(signer_name) <= 200)),
  signer_document TEXT NOT NULL CHECK (signer = 'patient' OR signer_document ~ '^[0-9]{4,8}$'),
  declared_by UUID NOT NULL REFERENCES users(id),
  declared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hygiene_preventive_consent_draft_idx ON hygiene_preventive_consent_declarations(draft_id, id);

CREATE FUNCTION preserve_hygiene_preventive_consent_declaration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hygiene preventive consent declaration is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER hygiene_preventive_consent_declaration_immutable BEFORE UPDATE OR DELETE ON hygiene_preventive_consent_declarations
  FOR EACH ROW EXECUTE FUNCTION preserve_hygiene_preventive_consent_declaration();
CREATE TRIGGER hygiene_preventive_consent_no_delete BEFORE DELETE ON hygiene_preventive_consent_declarations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
