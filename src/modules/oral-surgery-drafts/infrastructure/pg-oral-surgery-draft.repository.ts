import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../../shared/application/unit-of-work.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/domain/errors.js';
import type { ConsentDeclaration, ConsentHistory, DraftActor, DraftFilter, DraftInput, DraftRepositoryPort, DraftRow } from '../application/draft.ports.js';
import type { DraftContent } from '../domain/content.js';

const COLUMNS = `e.id::text, e.clinical_record_id::text, e.patient_id, e.author_id,
  e.origin_student_habilitation_id, e.origin_subject_id, e.origin_group_id,
  e.content, e.status, e.version::text, e.created_at, e.updated_at`;

// Bound role prevents a secondary profile from broadening the selected role's access.
const READ_ACCESS = `($3 = 'admin' OR ($3 = 'estudiante' AND e.author_id = $2 AND EXISTS (
  SELECT 1 FROM students s JOIN student_academic_habilitations sp ON sp.student_id = s.id
  JOIN patient_assignments a ON a.student_habilitation_id = sp.id AND a.subject_id = sp.subject_id
  WHERE s.user_id = $2 AND sp.subject_id = e.origin_subject_id
    AND sp.academic_group_id = e.origin_group_id AND sp.revoked_at IS NULL
    AND a.patient_id = e.patient_id AND a.ended_at IS NULL
)) OR ($3 = 'teacher' AND EXISTS (
  SELECT 1 FROM teachers t JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
  WHERE t.user_id = $2 AND th.subject_id = e.origin_subject_id
    AND th.academic_group_id = e.origin_group_id AND th.revoked_at IS NULL
)))`;

export class PgOralSurgeryDraftRepository implements DraftRepositoryPort {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  private student(actor: DraftActor): void {
    if (actor.role !== 'estudiante') throw new ForbiddenError('student author role required');
  }

  // Same order as assignment/revocation: student period -> patient -> assignment -> draft.
  // Locks keep authorization true through commit; a new valid period restores access.
  private async authorizeWrite(db: Queryable, input: Omit<DraftInput, 'content'>, actor: DraftActor): Promise<string> {
    const students = await db.query<{ id: string }>('SELECT id FROM students WHERE user_id = $1 FOR KEY SHARE', [actor.id]);
    if (!students.rows.length) throw new ForbiddenError('an active enabled student context is required');
    const periods = await db.query<{ id: string }>(
      `SELECT h.id FROM student_academic_habilitations h
       JOIN oral_surgery_subjects link ON link.subject_id = h.subject_id
       JOIN careers c ON c.id = link.career_id AND c.code = 'odontology'
       WHERE h.student_id = $1 AND h.subject_id = $2 AND h.academic_group_id = $3
         AND h.revoked_at IS NULL ORDER BY h.id FOR UPDATE OF h`,
      [students.rows[0].id, input.subjectId, input.groupId],
    );
    if (!periods.rows.length) throw new ForbiddenError('an active enabled student context is required');
    const patients = await db.query<{ id: string }>('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [input.patientId]);
    if (!patients.rows.length) throw new NotFoundError('patient was not found');
    const assignments = await db.query<{ id: string; student_habilitation_id: string }>(
      `SELECT a.id::text, a.student_habilitation_id FROM patient_assignments a
       WHERE a.patient_id = $1 AND a.student_habilitation_id = ANY($2::uuid[])
         AND a.subject_id = $3 AND a.ended_at IS NULL ORDER BY a.id FOR UPDATE OF a`,
      [input.patientId, periods.rows.map(row => row.id), input.subjectId],
    );
    const assignment = assignments.rows.find(row => periods.rows.some(period => period.id === row.student_habilitation_id));
    if (!assignment) throw new NotFoundError('patient was not found');
    return assignment.student_habilitation_id;
  }

  async create(input: DraftInput, actor: DraftActor): Promise<DraftRow> {
    this.student(actor);
    return this.unitOfWork.withTransaction(async db => {
      const period = await this.authorizeWrite(db, input, actor);
      // Reuse the same one-per-patient shared umbrella, never an Odontology copy.
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO clinical_records (patient_id, created_by) VALUES ($1, $2)
         ON CONFLICT (patient_id) DO NOTHING RETURNING id::text`, [input.patientId, actor.id],
      );
      const history = inserted.rows[0] ?? (await db.query<{ id: string }>(
        'SELECT id::text FROM clinical_records WHERE patient_id = $1', [input.patientId],
      )).rows[0];
      if (!history) throw new Error('clinical history was not available after atomic create/reuse');
      const result = await db.query<DraftRow>(
        `INSERT INTO oral_surgery_drafts AS e
         (clinical_record_id, patient_id, author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING ${COLUMNS}`,
        [history.id, input.patientId, actor.id, period, input.subjectId, input.groupId, JSON.stringify(input.content)],
      );
      return result.rows[0];
    });
  }

  async get(id: string, actor: DraftActor): Promise<DraftRow> {
    const result = await this.pool.query<DraftRow>(
      `SELECT ${COLUMNS} FROM oral_surgery_drafts e WHERE e.id = $1 AND ${READ_ACCESS}`, [id, actor.id, actor.role],
    );
    if (!result.rows.length) throw new NotFoundError('oral surgery draft was not found');
    return result.rows[0];
  }

  async list(filter: DraftFilter, actor: DraftActor): Promise<DraftRow[]> {
    const result = await this.pool.query<DraftRow>(
      `SELECT ${COLUMNS} FROM oral_surgery_drafts e WHERE ($1::uuid IS NULL OR e.patient_id = $1)
         AND ${READ_ACCESS} AND ($4::uuid IS NULL OR e.origin_subject_id = $4)
         AND ($5::uuid IS NULL OR e.origin_group_id = $5)
       ORDER BY e.id DESC LIMIT $6 OFFSET $7`,
      [filter.patientId ?? null, actor.id, actor.role, filter.subjectId ?? null, filter.groupId ?? null, filter.limit, filter.offset],
    );
    return result.rows;
  }

  async declareConsent(id: string, version: string, actor: DraftActor): Promise<ConsentDeclaration> {
    this.student(actor);
    return this.unitOfWork.withTransaction(async db => {
      const hint = (await db.query<DraftRow>(
        `SELECT ${COLUMNS} FROM oral_surgery_drafts e WHERE e.id = $1 AND e.author_id = $2`, [id, actor.id],
      )).rows[0];
      if (!hint) throw new NotFoundError('oral surgery draft was not found');
      try {
        await this.authorizeWrite(db, { patientId: hint.patient_id, subjectId: hint.origin_subject_id, groupId: hint.origin_group_id }, actor);
      } catch (error) {
        if (error instanceof ForbiddenError || error instanceof NotFoundError) throw new NotFoundError('oral surgery draft was not found');
        throw error;
      }
      const draft = (await db.query<{ version: string; plan_revision: string; content: DraftContent }>(
        'SELECT version::text, plan_revision::text, content FROM oral_surgery_drafts WHERE id = $1 FOR UPDATE', [id],
      )).rows[0];
      if (!draft || draft.version !== version) throw new ConflictError('draft version changed; reload before saving');
      return (await db.query<ConsentDeclaration>(
        `INSERT INTO oral_surgery_consent_declarations
         (draft_id, draft_version, plan_revision, treatment_plan, declared_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id::text, draft_id::text, draft_version::text, plan_revision::text,
                   treatment_plan, declared_by, declared_at`,
        [id, version, draft.plan_revision, JSON.stringify(draft.content.treatment_plan ?? null), actor.id],
      )).rows[0];
    });
  }

  async consentHistory(id: string, actor: DraftActor): Promise<ConsentHistory> {
    // One statement keeps access, current plan and history in the same MVCC snapshot.
    const result = await this.pool.query<ConsentHistory>(
      `SELECT e.version::text AS draft_version, e.plan_revision::text,
         (SELECT d.id::text FROM oral_surgery_consent_declarations d
          WHERE d.draft_id = e.id AND d.plan_revision = e.plan_revision ORDER BY d.id DESC LIMIT 1) AS current_declaration_id,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'id', d.id::text, 'draft_id', d.draft_id::text, 'draft_version', d.draft_version::text,
           'plan_revision', d.plan_revision::text, 'treatment_plan', d.treatment_plan,
           'declared_by', d.declared_by, 'declared_at', d.declared_at) ORDER BY d.id)
          FROM oral_surgery_consent_declarations d WHERE d.draft_id = e.id), '[]'::jsonb) AS declarations
       FROM oral_surgery_drafts e WHERE e.id = $1 AND ${READ_ACCESS}`, [id, actor.id, actor.role],
    );
    if (!result.rows.length) throw new NotFoundError('oral surgery draft was not found');
    const history = result.rows[0];
    history.declarations = history.declarations.map(row => ({
      ...row, declared_at: new Date(row.declared_at).toISOString(),
    }));
    return history;
  }

  async edit(id: string, version: string, content: DraftContent, actor: DraftActor): Promise<DraftRow> {
    this.student(actor);
    return this.unitOfWork.withTransaction(async db => {
      // An unauthorized or unknown ID has the same outward error, before any contextual write.
      const hint = (await db.query<DraftRow>(
        `SELECT ${COLUMNS} FROM oral_surgery_drafts e WHERE e.id = $1 AND e.author_id = $2`, [id, actor.id],
      )).rows[0];
      if (!hint) throw new NotFoundError('oral surgery draft was not found');
      try {
        await this.authorizeWrite(db, { patientId: hint.patient_id, subjectId: hint.origin_subject_id, groupId: hint.origin_group_id }, actor);
      } catch (error) {
        if (error instanceof ForbiddenError || error instanceof NotFoundError) throw new NotFoundError('oral surgery draft was not found');
        throw error;
      }
      const result = await db.query<DraftRow>(
        `UPDATE oral_surgery_drafts AS e SET content = $3::jsonb, version = version + 1,
           updated_at = clock_timestamp() WHERE e.id = $1 AND e.version = $2 AND e.author_id = $4
         RETURNING ${COLUMNS}`, [id, version, JSON.stringify(content), actor.id],
      );
      if (!result.rows.length) throw new ConflictError('draft version changed; reload before saving');
      return result.rows[0];
    });
  }
}
