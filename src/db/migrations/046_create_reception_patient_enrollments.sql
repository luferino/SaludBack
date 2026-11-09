-- Persistent administrative association; independent of subject/group availability.
CREATE TABLE reception_patient_enrollments (
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  career_id UUID NOT NULL REFERENCES careers(id) ON DELETE RESTRICT,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (patient_id, career_id)
);
CREATE INDEX reception_patient_enrollments_career_patient
  ON reception_patient_enrollments (career_id, patient_id);

INSERT INTO permissions (permission, enforced) VALUES ('reception:patients:manage', true);
INSERT INTO role_permissions (role, permission) VALUES ('reception', 'reception:patients:manage');
