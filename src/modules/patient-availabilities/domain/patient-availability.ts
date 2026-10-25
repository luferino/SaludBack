export interface PatientAvailability {
  id: string;
  patient_id: string;
  subject_id: string;
  academic_group_id: string;
  enabled_by: string;
  enabled_at: Date | string;
  withdrawn_by: string | null;
  withdrawn_at: Date | string | null;
}

export interface EnablePatientAvailabilityInput {
  patientId: string;
  subjectId: string;
  groupId: string;
  actorId: string;
}

export interface PatientAvailabilityPatient {
  patient_id: string;
  nombres: string;
  apellidos: string;
}
