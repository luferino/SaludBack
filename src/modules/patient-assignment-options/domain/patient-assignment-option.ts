export interface PatientAssignmentContextOption {
  subject_id: string;
  subject_name: string;
  academic_group_id: string;
  academic_group_name: string;
  academic_year: number;
  curriculum_semester: number;
}

export interface PatientAssignmentStudentOption {
  student_habilitation_id: string;
  student_id: string;
  nombres: string;
  apellidos: string;
}
