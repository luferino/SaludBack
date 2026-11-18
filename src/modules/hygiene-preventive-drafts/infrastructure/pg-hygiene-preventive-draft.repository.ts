import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../../shared/application/unit-of-work.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/domain/errors.js';
import type { DraftActor, DraftFilter, DraftInput, DraftRepositoryPort, DraftRow, ProcedureInput, ProcedureRow } from '../application/draft.ports.js';
import type { DraftContent } from '../domain/content.js';

const COLUMNS = `e.id::text, e.clinical_record_id::text, e.patient_id, e.author_id,
  e.origin_student_habilitation_id, e.origin_subject_id, e.origin_group_id,
  e.content, e.status, e.version::text, e.created_at, e.updated_at`;

const NOT_FOUND = 'hygiene preventive draft was not found';
const ENTRY_NOT_FOUND = 'procedure entry was not found';
const ENTRY_VERSION_CHANGED = 'procedure entry version changed; reload before saving';
const APPROVED_ENTRY = 'approved procedure entries cannot be changed';
const ENTRY_ALREADY_APPROVED = 'procedure entry is already approved';

const PROCEDURE_COLUMNS = `p.id::text, p.draft_id::text, to_char(p.procedure_date, 'YYYY-MM-DD') AS procedure_date,
  p.description, p.author_id, s.nombres || ' ' || s.apellidos AS student_name, p.version::text,
  p.approved_by, t.nombres || ' ' || t.apellidos AS teacher_name, p.approved_at, p.created_at, p.updated_at`;
const PROCEDURE_FROM = `FROM hygiene_preventive_procedures p
  LEFT JOIN students s ON s.user_id = p.author_id
  LEFT JOIN teachers t ON t.user_id = p.approved_by`;

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

export class PgHygienePreventiveDraftRepository implements DraftRepositoryPort {
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
       JOIN hygiene_preventive_subjects link ON link.subject_id = h.subject_id
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

  // Edits and their authorization failures answer with the same not-found body, before any write.
  private async authorizeOwnDraft(db: Queryable, id: string, actor: DraftActor): Promise<DraftRow> {
    const hint = (await db.query<DraftRow>(
      `SELECT ${COLUMNS} FROM hygiene_preventive_drafts e WHERE e.id = $1 AND e.author_id = $2`, [id, actor.id],
    )).rows[0];
    if (!hint) throw new NotFoundError(NOT_FOUND);
    try {
      await this.authorizeWrite(db, { patientId: hint.patient_id, subjectId: hint.origin_subject_id, groupId: hint.origin_group_id }, actor);
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof NotFoundError) throw new NotFoundError(NOT_FOUND);
      throw error;
    }
    return hint;
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
        `INSERT INTO hygiene_preventive_drafts AS e
         (clinical_record_id, patient_id, author_id, origin_student_habilitation_id, origin_subject_id, origin_group_id, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING ${COLUMNS}`,
        [history.id, input.patientId, actor.id, period, input.subjectId, input.groupId, JSON.stringify(input.content)],
      );
      return result.rows[0];
    });
  }

  async get(id: string, actor: DraftActor): Promise<DraftRow> {
    const result = await this.pool.query<DraftRow>(
      `SELECT ${COLUMNS} FROM hygiene_preventive_drafts e WHERE e.id = $1 AND ${READ_ACCESS}`, [id, actor.id, actor.role],
    );
    if (!result.rows.length) throw new NotFoundError(NOT_FOUND);
    return result.rows[0];
  }

  async list(filter: DraftFilter, actor: DraftActor): Promise<DraftRow[]> {
    const result = await this.pool.query<DraftRow>(
      `SELECT ${COLUMNS} FROM hygiene_preventive_drafts e WHERE ($1::uuid IS NULL OR e.patient_id = $1)
         AND ${READ_ACCESS} AND ($4::uuid IS NULL OR e.origin_subject_id = $4)
         AND ($5::uuid IS NULL OR e.origin_group_id = $5)
       ORDER BY e.id DESC LIMIT $6 OFFSET $7`,
      [filter.patientId ?? null, actor.id, actor.role, filter.subjectId ?? null, filter.groupId ?? null,
        filter.limit, filter.offset],
    );
    return result.rows;
  }

  async edit(id: string, version: string, content: DraftContent, actor: DraftActor): Promise<DraftRow> {
    this.student(actor);
    return this.unitOfWork.withTransaction(async db => {
      await this.authorizeOwnDraft(db, id, actor);
      const locked = (await db.query<{ version: string }>(
        'SELECT version::text FROM hygiene_preventive_drafts WHERE id = $1 FOR UPDATE', [id],
      )).rows[0];
      if (!locked || locked.version !== version) throw new ConflictError('draft version changed; reload before saving');
      const result = await db.query<DraftRow>(
        `UPDATE hygiene_preventive_drafts AS e SET content = $3::jsonb, version = version + 1,
           updated_at = clock_timestamp() WHERE e.id = $1 AND e.version = $2 AND e.author_id = $4
         RETURNING ${COLUMNS}`, [id, version, JSON.stringify(content), actor.id],
      );
      if (!result.rows.length) throw new ConflictError('draft version changed; reload before saving');
      return result.rows[0];
    });
  }

  async listProcedures(draftId: string, actor: DraftActor): Promise<ProcedureRow[]> {
    await this.get(draftId, actor);
    const result = await this.pool.query<ProcedureRow>(
      `SELECT ${PROCEDURE_COLUMNS} ${PROCEDURE_FROM} WHERE p.draft_id = $1 ORDER BY p.id`, [draftId],
    );
    return result.rows;
  }

  async addProcedure(draftId: string, input: ProcedureInput, actor: DraftActor): Promise<ProcedureRow> {
    this.student(actor);
    return this.unitOfWork.withTransaction(async db => {
      await this.lockOwnDraft(db, draftId, actor);
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO hygiene_preventive_procedures (draft_id, procedure_date, description, author_id)
         VALUES ($1, $2, $3, $4) RETURNING id::text`,
        [draftId, input.procedureDate, input.description, actor.id],
      );
      return this.procedureRow(db, inserted.rows[0].id);
    });
  }

  async editProcedure(draftId: string, procedureId: string, version: string, input: ProcedureInput,
    actor: DraftActor): Promise<ProcedureRow> {
    this.student(actor);
    return this.unitOfWork.withTransaction(async db => {
      await this.lockEditableEntry(db, draftId, procedureId, version, actor);
      const result = await db.query<{ id: string }>(
        `UPDATE hygiene_preventive_procedures SET procedure_date = $3, description = $4, version = version + 1,
           updated_at = clock_timestamp()
         WHERE id = $1 AND version = $2 AND approved_at IS NULL AND author_id = $5 RETURNING id::text`,
        [procedureId, version, input.procedureDate, input.description, actor.id],
      );
      if (!result.rows.length) throw new ConflictError(ENTRY_VERSION_CHANGED);
      return this.procedureRow(db, procedureId);
    });
  }

  async deleteProcedure(draftId: string, procedureId: string, version: string, actor: DraftActor): Promise<void> {
    this.student(actor);
    await this.unitOfWork.withTransaction(async db => {
      await this.lockEditableEntry(db, draftId, procedureId, version, actor);
      await db.query(
        'DELETE FROM hygiene_preventive_procedures WHERE id = $1 AND version = $2 AND approved_at IS NULL AND author_id = $3',
        [procedureId, version, actor.id],
      );
    });
  }

  // Teacher period -> draft -> entry, the same order as oral surgery authorization. Approval does not bump the draft version.
  async approveProcedure(draftId: string, procedureId: string, version: string, actor: DraftActor): Promise<ProcedureRow> {
    if (actor.role !== 'teacher') throw new ForbiddenError('teacher instructor role required');
    return this.unitOfWork.withTransaction(async db => {
      const hint = (await db.query<{ origin_subject_id: string; origin_group_id: string }>(
        'SELECT origin_subject_id, origin_group_id FROM hygiene_preventive_drafts WHERE id = $1', [draftId],
      )).rows[0];
      if (!hint) throw new NotFoundError(NOT_FOUND);
      // Teacher revocation and approval serialize on the same period before the draft and its entries.
      const periods = await db.query<{ id: string }>(
        `SELECT th.id FROM teacher_academic_habilitations th JOIN teachers t ON t.id = th.teacher_id
         WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3
           AND th.revoked_at IS NULL ORDER BY th.id FOR UPDATE OF th`,
        [actor.id, hint.origin_subject_id, hint.origin_group_id],
      );
      if (!periods.rows.length) throw new NotFoundError(NOT_FOUND);
      await db.query('SELECT id FROM hygiene_preventive_drafts WHERE id = $1 FOR KEY SHARE', [draftId]);
      const entry = (await db.query<{ version: string; approved_at: Date | null }>(
        `SELECT version::text, approved_at FROM hygiene_preventive_procedures
         WHERE id = $1 AND draft_id = $2 FOR UPDATE`,
        [procedureId, draftId],
      )).rows[0];
      if (!entry) throw new NotFoundError(ENTRY_NOT_FOUND);
      if (entry.approved_at !== null) throw new ConflictError(ENTRY_ALREADY_APPROVED);
      if (entry.version !== version) throw new ConflictError(ENTRY_VERSION_CHANGED);
      const result = await db.query<{ id: string }>(
        `UPDATE hygiene_preventive_procedures SET approved_by = $3, teacher_habilitation_id = $4,
           approved_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
         WHERE id = $1 AND version = $2 AND approved_at IS NULL RETURNING id::text`,
        [procedureId, version, actor.id, periods.rows[0].id],
      );
      if (!result.rows.length) throw new ConflictError(ENTRY_VERSION_CHANGED);
      return this.procedureRow(db, procedureId);
    });
  }

  // Same order as writes to the draft: authorized student period -> patient -> assignment -> draft -> entry.
  private async lockOwnDraft(db: Queryable, draftId: string, actor: DraftActor): Promise<void> {
    await this.authorizeOwnDraft(db, draftId, actor);
    await db.query('SELECT id FROM hygiene_preventive_drafts WHERE id = $1 FOR KEY SHARE', [draftId]);
  }

  // An approved entry is final, and a stale version must reload before any change.
  private async lockEditableEntry(db: Queryable, draftId: string, procedureId: string, version: string,
    actor: DraftActor): Promise<void> {
    await this.lockOwnDraft(db, draftId, actor);
    const entry = (await db.query<{ version: string; approved_at: Date | null }>(
      `SELECT version::text, approved_at FROM hygiene_preventive_procedures
       WHERE id = $1 AND draft_id = $2 AND author_id = $3 FOR UPDATE`,
      [procedureId, draftId, actor.id],
    )).rows[0];
    if (!entry) throw new NotFoundError(ENTRY_NOT_FOUND);
    if (entry.approved_at !== null) throw new ConflictError(APPROVED_ENTRY);
    if (entry.version !== version) throw new ConflictError(ENTRY_VERSION_CHANGED);
  }

  private async procedureRow(db: Queryable, id: string): Promise<ProcedureRow> {
    return (await db.query<ProcedureRow>(`SELECT ${PROCEDURE_COLUMNS} ${PROCEDURE_FROM} WHERE p.id = $1`, [id])).rows[0];
  }
}
