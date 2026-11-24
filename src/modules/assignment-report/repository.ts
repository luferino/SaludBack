import type { Pool } from 'pg';

type AssignmentCount = {
  career: string;
  subject_id: string;
  academic_group_id: string;
  assignment_count: number;
};

export interface AssignmentReportRepository {
  countByContext(from: string, to: string): Promise<readonly AssignmentCount[]>;
}

export class PgAssignmentReportRepository implements AssignmentReportRepository {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async countByContext(from: string, to: string): Promise<AssignmentCount[]> {
    // Local calendar bounds are converted independently to preserve historical offset changes.
    const { rows } = await this.pool.query<AssignmentCount>(`
      SELECT c.code AS career, a.subject_id, h.academic_group_id,
             count(*)::integer AS assignment_count
      FROM patient_assignments AS a
      JOIN student_academic_habilitations AS h ON h.id = a.student_habilitation_id
      JOIN subjects AS s ON s.id = a.subject_id
      JOIN careers AS c ON c.id = s.career_id
      WHERE a.assigned_at >= ($1::date::timestamp AT TIME ZONE $3)
        AND a.assigned_at < (($2::date + 1)::timestamp AT TIME ZONE $3)
      GROUP BY c.code, a.subject_id, h.academic_group_id
      ORDER BY c.code, a.subject_id, h.academic_group_id
    `, [from, to, 'America/Asuncion']);
    return rows;
  }
}
