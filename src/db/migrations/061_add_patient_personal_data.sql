-- Marital status and medical insurance on the shared patient record. Both columns are nullable: NULL means
-- not recorded, and existing patients keep NULL (no backfill). Only the current value is kept; the audit
-- columns updated_by/updated_at from migration 004 record who changed it and when. The allowed tokens are
-- enforced by named CHECK constraints so the database rejects any other value.
ALTER TABLE patients
  ADD COLUMN marital_status TEXT,
  ADD COLUMN medical_insurance TEXT,
  ADD CONSTRAINT patients_marital_status_check
    CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed', 'civil_union')),
  ADD CONSTRAINT patients_medical_insurance_check
    CHECK (medical_insurance IN ('ips', 'police_health', 'military_health', 'none'));
