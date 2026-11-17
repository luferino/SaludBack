-- Append-only clinical history: the application never updates or deletes these rows, and the
-- database now rejects every DELETE statement on them. Statement-level triggers fire even when no
-- row matches, so a bulk or targeted DELETE fails before touching data. TRUNCATE remains an
-- administrative operation (integration cleanup depends on it). Mutable clinical records
-- (evaluations, evolutions, drafts, operative reports, clinical records) are intentionally excluded.
CREATE FUNCTION reject_clinical_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'clinical history rows cannot be deleted from %', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_consent_attestations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evaluation_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evaluation_submission_studies
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evaluation_correction_requests
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evaluation_validation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evaluation_amendment_links
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evolution_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evolution_correction_requests
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evolution_validation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON kinesiology_evolution_amendment_links
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON oral_surgery_consent_declarations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON oral_surgery_authorizations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
CREATE TRIGGER clinical_history_no_delete BEFORE DELETE ON oral_surgery_practical_evaluations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_delete();
