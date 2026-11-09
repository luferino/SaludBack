import type { Pool } from 'pg';
import type { Queryable } from '../../../shared/application/unit-of-work.js';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { PatientAvailability } from '../../../patient-availabilities/domain/patient-availability.js';
import type { ReceptionAvailabilityRepository } from '../../application/reception-availability.ports.js';
import { PgReceptionAccessRepository } from './pg-reception-access.repository.js';

interface ContextChoice { career: string; subject_id: string; academic_group_id: string; subject_name: string; academic_group_name: string }
interface PatientChoice { patient_id: string; nombres: string; apellidos: string }
const COLUMNS = 'a.id::text AS id, a.patient_id, a.subject_id, a.academic_group_id, a.enabled_by, a.enabled_at, a.withdrawn_by, a.withdrawn_at';

export class PgReceptionAvailabilityRepository implements ReceptionAvailabilityRepository {
  private readonly access: PgReceptionAccessRepository;
  constructor(private readonly pool: Pool) { this.access = new PgReceptionAccessRepository(pool); }
  withActiveCareerScope<T>(userId: string, career: string, work: (db: Queryable) => Promise<T>): Promise<T> {
    return this.access.withActiveCareerScope(userId, career, work);
  }

  async contextChoices(db: Queryable, career: string, limit: number, offset: number) {
    const { rows } = await db.query<ContextChoice>(`SELECT $1::text AS career, s.id::text AS subject_id, g.id::text AS academic_group_id,
        s.name AS subject_name, concat(g.academic_year, ' · ', g.curriculum_semester, ' · ', g.name) AS academic_group_name
      FROM subject_academic_groups sg JOIN subjects s ON s.id=sg.subject_id JOIN academic_groups g ON g.id=sg.academic_group_id
      JOIN careers c ON c.id=sg.career_id WHERE c.code=$1 ORDER BY s.name,g.academic_year,g.curriculum_semester,g.name,s.id,g.id LIMIT $2 OFFSET $3`, [career,limit,offset]);
    return rows;
  }

  async enable(db: Queryable, career: string, input: { patientId: string; subjectId: string; groupId: string; actorId: string }): Promise<PatientAvailability> {
    const patient = await db.query(`SELECT p.id FROM patients p JOIN reception_patient_enrollments e ON e.patient_id=p.id
      JOIN careers c ON c.id=e.career_id WHERE p.id=$1 AND c.code=$2 FOR UPDATE OF p`, [input.patientId, career]);
    if (!patient.rows.length) throw new NotFoundError('enrolled patient was not found');
    const context = await db.query(`SELECT sg.subject_id FROM subject_academic_groups sg JOIN careers c ON c.id=sg.career_id
      WHERE sg.subject_id=$1 AND sg.academic_group_id=$2 AND c.code=$3`, [input.subjectId, input.groupId, career]);
    if (!context.rows.length) throw new NotFoundError('subject or academic group was not found in career');
    try {
      const { rows } = await db.query<PatientAvailability>(`INSERT INTO patient_context_availabilities(patient_id,subject_id,academic_group_id,enabled_by)
        VALUES($1,$2,$3,$4) RETURNING id::text AS id,patient_id,subject_id,academic_group_id,enabled_by,enabled_at,withdrawn_by,withdrawn_at`,
      [input.patientId, input.subjectId, input.groupId, input.actorId]);
      return rows[0];
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'patient_context_availabilities_one_active') throw new ConflictError('patient is already available in this context');
      throw error;
    }
  }

  async withdraw(db: Queryable, career: string, id: string, actorId: string): Promise<PatientAvailability> {
    const located = await db.query<{ patient_id: string }>(`SELECT a.patient_id FROM patient_context_availabilities a
      JOIN reception_patient_enrollments e ON e.patient_id=a.patient_id
      JOIN subject_academic_groups sg ON sg.subject_id=a.subject_id AND sg.academic_group_id=a.academic_group_id AND sg.career_id=e.career_id
      JOIN careers c ON c.id=sg.career_id WHERE a.id=$1 AND c.code=$2`, [id, career]);
    if (!located.rows.length) throw new NotFoundError('patient availability was not found');
    const patient = await db.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE', [located.rows[0].patient_id]);
    if (!patient.rows.length) throw new NotFoundError('patient availability was not found');
    const { rows } = await db.query<PatientAvailability>(`UPDATE patient_context_availabilities a SET withdrawn_by=COALESCE(a.withdrawn_by,$3),
      withdrawn_at=COALESCE(a.withdrawn_at,clock_timestamp()) WHERE a.id=$1 AND EXISTS
      (SELECT 1 FROM reception_patient_enrollments e JOIN subject_academic_groups sg
        ON sg.subject_id=a.subject_id AND sg.academic_group_id=a.academic_group_id AND sg.career_id=e.career_id
        JOIN careers c ON c.id=sg.career_id WHERE e.patient_id=a.patient_id AND c.code=$2)
      RETURNING a.id::text AS id,a.patient_id,a.subject_id,a.academic_group_id,a.enabled_by,a.enabled_at,a.withdrawn_by,a.withdrawn_at`, [id, career, actorId]);
    if (!rows.length) throw new NotFoundError('patient availability was not found');
    return rows[0];
  }

  async history(db: Queryable, career: string, patientId: string, limit: number, offset: number): Promise<PatientAvailability[]> {
    const enrolled = await db.query<{ id: string }>(`SELECT p.id FROM patients p JOIN reception_patient_enrollments e ON e.patient_id=p.id
      JOIN careers c ON c.id=e.career_id WHERE p.id=$1 AND c.code=$2 FOR UPDATE OF p`, [patientId, career]);
    if (!enrolled.rows.length) throw new NotFoundError('enrolled patient was not found');
    const { rows } = await db.query<PatientAvailability>(`SELECT ${COLUMNS} FROM patient_context_availabilities a
      JOIN subject_academic_groups sg ON sg.subject_id=a.subject_id AND sg.academic_group_id=a.academic_group_id JOIN careers c ON c.id=sg.career_id
      WHERE a.patient_id=$1 AND c.code=$2 ORDER BY a.enabled_at DESC,a.id DESC LIMIT $3 OFFSET $4`, [patientId, career, limit, offset]);
    return rows;
  }

  async search(db: Queryable, career: string, documento: string, limit: number, offset: number) {
    const { rows } = await db.query<PatientChoice>(`SELECT p.id::text AS patient_id,p.nombres,p.apellidos FROM patients p
      JOIN reception_patient_enrollments e ON e.patient_id=p.id JOIN careers c ON c.id=e.career_id
      WHERE c.code=$1 AND p.documento=$2 ORDER BY p.apellidos,p.nombres,p.id LIMIT $3 OFFSET $4 FOR UPDATE OF p`, [career, documento, limit, offset]);
    return rows;
  }
}
