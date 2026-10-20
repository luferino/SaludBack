import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { PermissionGuard } from '../shared/application/guard.js';
import type { Guard } from '../shared/application/guard.js';
import type { UnitOfWorkPort } from '../shared/application/unit-of-work.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../shared/domain/errors.js';
import { defaultGetActor } from '../shared/infrastructure/default-get-actor.js';
import { isCanonicalUuid } from '../subject-groups/application/create-subject-group.usecase.js';

interface AssignmentRow {
  id: string;
  patient_id: string;
  student_habilitation_id: string;
  subject_id: string;
  academic_group_id: string;
  assigned_by: string;
  assigned_at: Date | string;
  ended_by: string | null;
  ended_at: Date | string | null;
  end_reason: string | null;
  nombres?: string;
  apellidos?: string;
  documento?: string;
}

interface AssignmentInput {
  patientId: string;
  periodId: string;
  subjectId: string;
  groupId: string;
  actorId: string;
}

const LIST_COLUMNS = `
  a.id::text AS id, a.patient_id, a.student_habilitation_id, a.subject_id,
  p.academic_group_id, a.assigned_by, a.assigned_at, a.ended_by, a.ended_at,
  a.end_reason, pt.nombres, pt.apellidos, pt.documento`;

export class PgPatientAssignmentRepository {
  constructor(private readonly unitOfWork: UnitOfWorkPort, private readonly pool: Pool) {}

  async create(input: AssignmentInput): Promise<AssignmentRow> {
    try {
      return await this.unitOfWork.withTransaction(async (db) => {
        const teacher = await db.query<{ id: string }>(
          'SELECT id FROM teachers WHERE user_id = $1 FOR KEY SHARE',
          [input.actorId],
        );
        if (!teacher.rows.length) {
          throw new ForbiddenError('an active teacher context is required');
        }

        // T2/T3/T4 share this teacher -> student-period -> patient lock order.
        const contexts = await db.query<{ id: string }>(
          `SELECT id FROM teacher_academic_habilitations
            WHERE teacher_id = $1 AND subject_id = $2 AND academic_group_id = $3
              AND revoked_at IS NULL
            ORDER BY id FOR UPDATE`,
          [teacher.rows[0].id, input.subjectId, input.groupId],
        );
        if (!contexts.rows.length) {
          throw new ForbiddenError('an active teacher context is required');
        }

        const periods = await db.query<{ id: string; academic_group_id: string }>(
          `SELECT id, academic_group_id FROM student_academic_habilitations
            WHERE id = $1 AND subject_id = $2 AND academic_group_id = $3 AND revoked_at IS NULL
            ORDER BY id FOR UPDATE`,
          [input.periodId, input.subjectId, input.groupId],
        );
        if (!periods.rows.length) {
          throw new NotFoundError('active matching student habilitation was not found');
        }

        const patients = await db.query<{ id: string }>(
          'SELECT id FROM patients WHERE id = $1 FOR UPDATE',
          [input.patientId],
        );
        if (!patients.rows.length) {
          throw new NotFoundError('patient was not found');
        }

        const inserted = await db.query<Omit<AssignmentRow, 'academic_group_id'>>(
          `INSERT INTO patient_assignments
             (patient_id, student_habilitation_id, subject_id, assigned_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id::text AS id, patient_id, student_habilitation_id, subject_id,
                     assigned_by, assigned_at, ended_by, ended_at, end_reason`,
          [input.patientId, input.periodId, input.subjectId, input.actorId],
        );
        return { ...inserted.rows[0], academic_group_id: periods.rows[0].academic_group_id };
      });
    } catch (error) {
      const dbError = error as { code?: string; constraint?: string };
      if (dbError.code === '23505' && dbError.constraint === 'patient_assignments_one_active_patient_subject') {
        throw new ConflictError('patient already has an active assignment for this subject');
      }
      if (dbError.code === '23503' && dbError.constraint === 'patient_assignments_period_subject_fk') {
        throw new NotFoundError('active matching student habilitation was not found');
      }
      throw error;
    }
  }

  listTeacher(actor: string, limit: number, offset: number): Promise<AssignmentRow[]> {
    const teacherContext = `EXISTS (
      SELECT 1 FROM teachers t
      JOIN teacher_academic_habilitations th ON th.teacher_id = t.id
      WHERE t.user_id = $1 AND th.subject_id = a.subject_id
        AND th.academic_group_id = p.academic_group_id AND th.revoked_at IS NULL
    )`;
    return this.list(teacherContext, actor, limit, offset);
  }

  listOwn(actor: string, limit: number, offset: number): Promise<AssignmentRow[]> {
    return this.list('p.student_id = (SELECT id FROM students WHERE user_id = $1)', actor, limit, offset);
  }

  private async list(scope: string, actor: string, limit: number, offset: number): Promise<AssignmentRow[]> {
    const { rows } = await this.pool.query<AssignmentRow>(
      `SELECT ${LIST_COLUMNS}
         FROM patient_assignments a
         JOIN student_academic_habilitations p ON p.id = a.student_habilitation_id
         JOIN patients pt ON pt.id = a.patient_id
        WHERE a.ended_at IS NULL AND p.revoked_at IS NULL AND ${scope}
        ORDER BY a.id LIMIT $2 OFFSET $3`,
      [actor, limit, offset],
    );
    return rows.map((row) => ({
      ...row,
      assigned_at: new Date(row.assigned_at).toISOString(),
      ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    }));
  }
}

function uuid(value: unknown, field: string): string {
  if (!isCanonicalUuid(value)) throw new BadRequestError(`${field} must be a UUID`);
  return value;
}

function verifiedActor(getActor: (req: Request) => Promise<string | null>, req: Request): Promise<string> {
  return getActor(req).then((actor) => {
    if (!isCanonicalUuid(actor)) throw new UnauthorizedError('A verified UUID actor is required');
    return actor;
  });
}

function pagination(query: Request['query']): { limit: number; offset: number } {
  const integer = (value: unknown, fallback: number, field: string): number => {
    if (value === undefined) return fallback;
    if (Array.isArray(value) || typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new BadRequestError(`${field} must be an integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new BadRequestError(`${field} must be an integer`);
    return parsed;
  };
  const limit = integer(query.limit, 50, 'limit');
  const offset = integer(query.offset, 0, 'offset');
  if (limit < 1 || limit > 100) throw new BadRequestError('limit must be between 1 and 100');
  return { limit, offset };
}

function serialize(row: AssignmentRow) {
  return {
    id: row.id,
    patient_id: row.patient_id,
    student_habilitation_id: row.student_habilitation_id,
    subject_id: row.subject_id,
    academic_group_id: row.academic_group_id,
    assigned_by: row.assigned_by,
    assigned_at: new Date(row.assigned_at).toISOString(),
    ended_by: row.ended_by,
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    end_reason: row.end_reason,
    ...(row.nombres === undefined ? {} : {
      nombres: row.nombres,
      apellidos: row.apellidos,
      documento: row.documento,
    }),
  };
}

export function createPatientAssignmentRouter({
  repository,
  writeGuard = new PermissionGuard('patient-assignments:write'),
  readGuard = new PermissionGuard('patient-assignments:read'),
  ownGuard = new PermissionGuard('patient-assignments:read-own'),
  getActor = defaultGetActor,
}: {
  repository: PgPatientAssignmentRepository;
  writeGuard?: Guard;
  readGuard?: Guard;
  ownGuard?: Guard;
  getActor?: (req: Request) => Promise<string | null>;
}): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    await writeGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const row = await repository.create({
      patientId: uuid(req.body?.patient_id, 'patient_id'),
      periodId: uuid(req.body?.student_habilitation_id, 'student_habilitation_id'),
      subjectId: uuid(req.body?.subject_id, 'subject_id'),
      groupId: uuid(req.body?.academic_group_id, 'academic_group_id'),
      actorId: actor,
    });
    res.status(201).json(serialize(row));
  });

  router.get('/', async (req: Request, res: Response) => {
    await readGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const page = pagination(req.query);
    const items = await repository.listTeacher(actor, page.limit, page.offset);
    res.status(200).json({ items: items.map(serialize), ...page });
  });

  router.get('/mine', async (req: Request, res: Response) => {
    await ownGuard.authorize(req);
    const actor = await verifiedActor(getActor, req);
    const page = pagination(req.query);
    const items = await repository.listOwn(actor, page.limit, page.offset);
    res.status(200).json({ items: items.map(serialize), ...page });
  });

  return router;
}
