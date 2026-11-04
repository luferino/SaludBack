-- Link each separately authored evolution amendment to its immutable validated origin.
CREATE UNIQUE INDEX kinesiology_evolutions_amendment_identity_unique
  ON kinesiology_evolutions(id, evaluation_id, clinical_record_id, patient_id, origin_subject_id, origin_group_id);

CREATE TABLE kinesiology_evolution_amendment_links (
  amendment_evolution_id BIGINT PRIMARY KEY,
  original_evolution_id BIGINT NOT NULL,
  evaluation_id BIGINT NOT NULL,
  clinical_record_id BIGINT NOT NULL,
  patient_id UUID NOT NULL,
  origin_subject_id UUID NOT NULL,
  origin_group_id UUID NOT NULL,
  CHECK (amendment_evolution_id <> original_evolution_id),
  FOREIGN KEY (amendment_evolution_id, evaluation_id, clinical_record_id, patient_id, origin_subject_id, origin_group_id)
    REFERENCES kinesiology_evolutions(id, evaluation_id, clinical_record_id, patient_id, origin_subject_id, origin_group_id) ON DELETE RESTRICT,
  FOREIGN KEY (original_evolution_id, evaluation_id, clinical_record_id, patient_id, origin_subject_id, origin_group_id)
    REFERENCES kinesiology_evolutions(id, evaluation_id, clinical_record_id, patient_id, origin_subject_id, origin_group_id) ON DELETE RESTRICT
);
CREATE INDEX kinesiology_evolution_amendment_links_original_idx
  ON kinesiology_evolution_amendment_links(original_evolution_id, amendment_evolution_id);
