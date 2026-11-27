import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../../shared/application/unit-of-work.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/domain/errors.js';
import type { DraftActor, DraftFilter, DraftInput, DraftRepositoryPort, DraftRow } from '../application/draft.ports.js';
const COLUMNS = `e.id::text, e.clinical_record_id::text, e.patient_id, e.author_id, e.origin_student_habilitation_id, e.origin_subject_id, e.origin_group_id, e.content, e.status, e.version::text, e.created_at, e.updated_at`;
const NOT_FOUND = 'endodontics draft was not found';
const ACCESS = `($3 = 'admin' OR ($3 = 'estudiante' AND e.author_id = $2 AND EXISTS (
 SELECT 1 FROM students s JOIN student_academic_habilitations h ON h.student_id=s.id
 JOIN patient_assignments a ON a.student_habilitation_id=h.id AND a.subject_id=h.subject_id
 WHERE s.user_id=$2 AND h.subject_id=e.origin_subject_id AND h.academic_group_id=e.origin_group_id
 AND h.revoked_at IS NULL AND a.patient_id=e.patient_id AND a.ended_at IS NULL)) OR ($3='teacher' AND EXISTS (
 SELECT 1 FROM teachers t JOIN teacher_academic_habilitations h ON h.teacher_id=t.id
 WHERE t.user_id=$2 AND h.subject_id=e.origin_subject_id AND h.academic_group_id=e.origin_group_id AND h.revoked_at IS NULL)))`;
export class PgEndodonticsDraftRepository implements DraftRepositoryPort {
 constructor(private readonly uow: UnitOfWorkPort, private readonly pool: Pool) {}
 private student(actor: DraftActor) { if (actor.role !== 'estudiante') throw new ForbiddenError('student author role required'); }
 private async authorize(db: Queryable, input: { patientId: string; subjectId: string; groupId: string }, actor: DraftActor): Promise<string> {
  const student = (await db.query<{id:string}>('SELECT id FROM students WHERE user_id=$1 FOR KEY SHARE',[actor.id])).rows[0];
  if (!student) throw new ForbiddenError('an active enabled student context is required');
  const periods = await db.query<{id:string}>(`SELECT h.id FROM student_academic_habilitations h JOIN endodontics_subjects l ON l.subject_id=h.subject_id
   WHERE h.student_id=$1 AND h.subject_id=$2 AND h.academic_group_id=$3 AND h.revoked_at IS NULL ORDER BY h.id FOR UPDATE OF h`,[student.id,input.subjectId,input.groupId]);
  if (!periods.rows.length) throw new ForbiddenError('an active enabled student context is required');
  const patients = await db.query<{id:string}>('SELECT id FROM patients WHERE id=$1 FOR UPDATE',[input.patientId]);
  if (!patients.rows.length) throw new NotFoundError('patient was not found');
  const assignments = await db.query<{student_habilitation_id:string}>(`SELECT a.student_habilitation_id FROM patient_assignments a
   WHERE a.patient_id=$1 AND a.subject_id=$2 AND a.ended_at IS NULL AND a.student_habilitation_id=ANY($3::uuid[]) ORDER BY a.id FOR UPDATE OF a`,[input.patientId,input.subjectId,periods.rows.map(x=>x.id)]);
  const matched = assignments.rows.find(x=>periods.rows.some(p=>p.id===x.student_habilitation_id));
  if (!matched) throw new NotFoundError('patient was not found'); return matched.student_habilitation_id;
 }
 async create(input: DraftInput, actor: DraftActor): Promise<DraftRow> {
  this.student(actor); return this.uow.withTransaction(async db=>{
   const period=await this.authorize(db,input,actor);
   const inserted=await db.query<{id:string}>('INSERT INTO clinical_records(patient_id,created_by) VALUES($1,$2) ON CONFLICT(patient_id) DO NOTHING RETURNING id::text',[input.patientId,actor.id]);
   const history=inserted.rows[0]??(await db.query<{id:string}>('SELECT id::text FROM clinical_records WHERE patient_id=$1',[input.patientId])).rows[0];
   const result=await db.query<DraftRow>(`INSERT INTO endodontics_drafts AS e (clinical_record_id,patient_id,author_id,origin_student_habilitation_id,origin_subject_id,origin_group_id,content)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING ${COLUMNS}`,[history.id,input.patientId,actor.id,period,input.subjectId,input.groupId,JSON.stringify(input.content)]); return result.rows[0];
  });
 }
 async get(id:string,actor:DraftActor):Promise<DraftRow>{const r=await this.pool.query<DraftRow>(`SELECT ${COLUMNS} FROM endodontics_drafts e WHERE e.id=$1 AND ${ACCESS}`,[id,actor.id,actor.role]);if(!r.rows[0])throw new NotFoundError(NOT_FOUND);return r.rows[0];}
 async list(filter:DraftFilter,actor:DraftActor):Promise<DraftRow[]>{return (await this.pool.query<DraftRow>(`SELECT ${COLUMNS} FROM endodontics_drafts e WHERE ($1::uuid IS NULL OR patient_id=$1) AND ${ACCESS} ORDER BY e.id DESC LIMIT $4 OFFSET $5`,[filter.patientId??null,actor.id,actor.role,filter.limit,filter.offset])).rows;}
 async edit(id:string,version:string,content:DraftInput['content'],actor:DraftActor):Promise<DraftRow>{this.student(actor);return this.uow.withTransaction(async db=>{
  const hint=(await db.query<DraftRow>(`SELECT ${COLUMNS} FROM endodontics_drafts e WHERE id=$1 AND author_id=$2`,[id,actor.id])).rows[0];if(!hint)throw new NotFoundError(NOT_FOUND);
  try{await this.authorize(db,{patientId:hint.patient_id,subjectId:hint.origin_subject_id,groupId:hint.origin_group_id},actor);}catch(e){if(e instanceof ForbiddenError||e instanceof NotFoundError)throw new NotFoundError(NOT_FOUND);throw e;}
  const locked=(await db.query<{version:string}>('SELECT version::text FROM endodontics_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!locked||locked.version!==version)throw new ConflictError('draft version changed; reload before saving');
  const r=await db.query<DraftRow>(`UPDATE endodontics_drafts e SET content=$3::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2 AND author_id=$4 RETURNING ${COLUMNS}`,[id,version,JSON.stringify(content),actor.id]);if(!r.rows[0])throw new ConflictError('draft version changed; reload before saving');return r.rows[0];
 });}
}
