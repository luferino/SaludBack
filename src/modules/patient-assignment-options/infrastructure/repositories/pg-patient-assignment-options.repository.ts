import type { Pool } from 'pg';
import type { PatientAssignmentOptionsRepositoryPort } from '../../application/patient-assignment-options.ports.js';
import type { PatientAssignmentContextOption, PatientAssignmentStudentOption } from '../../domain/patient-assignment-option.js';

export class PgPatientAssignmentOptionsRepository implements PatientAssignmentOptionsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listContexts(actorId: string, limit: number, offset: number): Promise<PatientAssignmentContextOption[]> {
    const { rows } = await this.pool.query<PatientAssignmentContextOption>(
      `SELECT DISTINCT s.id AS subject_id, s.name AS subject_name,
              ag.id AS academic_group_id, ag.name AS academic_group_name,
              ag.academic_year, ag.curriculum_semester
         FROM teachers t
         JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
         JOIN subjects s ON s.id = th.subject_id
         JOIN academic_groups ag ON ag.id = th.academic_group_id
        WHERE t.user_id = $1 AND th.revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM student_academic_habilitations period
             WHERE period.subject_id = th.subject_id
               AND period.academic_group_id = th.academic_group_id
               AND period.revoked_at IS NULL
          )
        ORDER BY s.name ASC, s.id ASC, ag.name ASC, ag.id ASC
        LIMIT $2 OFFSET $3`,
      [actorId, limit, offset],
    );
    return rows.map(row => ({
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      academic_group_id: row.academic_group_id,
      academic_group_name: row.academic_group_name,
      academic_year: row.academic_year,
      curriculum_semester: row.curriculum_semester,
    }));
  }

  async listStudents(actorId: string, subjectId: string, academicGroupId: string, limit: number, offset: number, q?: string): Promise<PatientAssignmentStudentOption[]> {
    const pattern = q ? '%' + q.replace(/[\\%_]/g, '\\$&') + '%' : undefined;
    const search = pattern ? ' AND (student.nombres ILIKE $6 OR student.apellidos ILIKE $6)' : '';
    const { rows } = await this.pool.query<PatientAssignmentStudentOption>(
      `SELECT period.id AS student_habilitation_id, student.id AS student_id,
              student.nombres, student.apellidos
         FROM teachers t
         JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
         JOIN student_academic_habilitations period
           ON period.subject_id = th.subject_id AND period.academic_group_id = th.academic_group_id
         JOIN students student ON student.id = period.student_id
        WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3
          AND th.revoked_at IS NULL AND period.revoked_at IS NULL${search}
        ORDER BY student.nombres ASC, student.apellidos ASC, student.id ASC, period.id ASC
        LIMIT $4 OFFSET $5`,
      pattern ? [actorId, subjectId, academicGroupId, limit, offset, pattern] : [actorId, subjectId, academicGroupId, limit, offset],
    );
    return rows.map(row => ({
      student_habilitation_id: row.student_habilitation_id,
      student_id: row.student_id,
      nombres: row.nombres,
      apellidos: row.apellidos,
    }));
  }
}
