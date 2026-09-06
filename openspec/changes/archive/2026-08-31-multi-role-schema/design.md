# Design: Multi-Role Schema (Students & Teachers) with Audit Columns

## Technical Approach

Additive plain-SQL migration `004` (own transaction, lexical after `003`). New `students`/`teachers` modules mirror the patients module (entity → ports → use case → pg repository → routes). Repos stay thin positional-`$n` mappers with `rowToX` helpers. `authenticate` surfaces token `sub` so `defaultGetActor` (PAT-004) resolves attribution. `teacher` role added; audit columns internal (`toJSON` whitelists keep responses byte-stable).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| codalumno uniqueness/normalization | `UNIQUE (lower(codalumno))` functional index; store as typed, query via `lower()` | No citext ext (keeps plain TEXT); preserves response fidelity (STU-004); case-insensitive dup → 409 |
| codalumno format | Check constraint + use-case regex `^[A-Za-z0-9]+$` (pure alnum) | `12_34A` fails; `2024-00123` also fails (consistent with spec STU-003) |
| alta-en-uno atomicity | Per-module `UnitOfWorkPort.withTransaction(client=>...)`; repos take optional `client` (default pool) | user+profile persist together or not at all; fake pool keeps unit tests trivial |
| created_by source | `getActor` reads `req.auth.userId ?? sub` | reuses patients seam; open route → null |
| link resolution | `UserRepositoryPort` gains audit-carrying rows; uses `findByUsername`/`findByEmail` | no new adapter needed |

## Data Flow

```
POST /students|/teachers (OpenGuard → getActor)
  └─ CreateStudent|CreateTeacher
       ├─ validate required + codalumno(`[A-Za-z0-9]+`) + email format
       ├─ resolve user: findByUsername OR findByEmail
       │    ├─ found → link (no user write, role unchanged)
       │    └─ none → hasher.hash → repository.create(user, role)
       └─ tx: profile.create({user_id, nombres, apellidos, [codalumno], email?, celular?, created_by}, client)
            → 201 whitelisted toJSON
```
Order: validate (400) → codalumno dup (409) → create-or-link. User role: `estudiante`/`teacher`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/db/migrations/004_multi_role_and_audit.sql` | Create | ALTER users/patients, create students/teachers, indexes/checks |
| `src/modules/auth/domain/user.entity.ts` | Modify | add audit fields; `toJSON` excludes them |
| `src/modules/auth/application/auth.ports.ts` | Modify | rows carry audit fields |
| `src/modules/auth/infrastructure/repositories/pg-user.repository.ts` | Modify | insert `created_by` NULL + audit; USER_COLUMNS shift |
| `src/modules/auth/infrastructure/middleware/authenticate.ts` | Modify | `AuthenticatedRequest` gains `sub?`/`userId?`; copy `decoded.sub` → `req.auth` |
| `src/modules/auth/domain/permissions.ts` | Modify | add `teacher` role |
| `src/modules/patients/domain/patient.entity.ts` | Modify | add `updatedBy`/`updatedAt`; 11-key `toJSON` unchanged |
| `src/modules/patients/infrastructure/repositories/pg-patient.repository.ts` | Modify | return `updated_*`; create leaves NULL |
| `src/modules/patients/infrastructure/routes/patient.routes.ts` | Modify | `defaultGetActor` reads `req.auth.userId ?? sub` |
| `src/modules/students/{domain,application,infrastructure}/**` | Create | entity, `StudentRepositoryPort`, `CreateStudent`, `pg-student.repository.ts`, `student.routes.ts` |
| `src/modules/teachers/**` | Create | mirror (no codalumno) |
| `src/index.ts` | Modify | mount `/students` `/teachers` (+ UOW) |
| `tests/unit`, `tests/integration` | Modify/Create | lockstep contracts, FK order, real-middleware actor |

## Interfaces / Contracts

```ts
export interface StudentRepositoryPort {
  findByCodalumno(codalumno: string): Promise<Student | null>;
  create(s: Student, client?: Queryable): Promise<Student>; // Queryable = { query(...) }
}
export interface AuthenticatedRequest extends Request {
  auth?: { role: string; permissions: string[]; sub?: string; userId?: string };
}
export interface UnitOfWorkPort { withTransaction<T>(fn: (c: Queryable) => Promise<T>): Promise<T>; }
```

`Student.toJSON()` keys: `id, nombres, apellidos, codalumno, email, celular, created_by, created_at` (STU-004; validated email normalized to `null` when absent). `Teacher.toJSON()`: same minus `codalumno` (TEA-003).

## Migration 004 (SQL sketch)

```sql
ALTER TABLE users ADD COLUMN created_by UUID REFERENCES users(id),
  ADD COLUMN updated_by UUID REFERENCES users(id), ADD COLUMN updated_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN updated_by UUID REFERENCES users(id), ADD COLUMN updated_at TIMESTAMPTZ;
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  nombres TEXT NOT NULL, apellidos TEXT NOT NULL, codalumno TEXT NOT NULL,
  email TEXT, celular TEXT,
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id), updated_at TIMESTAMPTZ,
  CONSTRAINT codalumno_format CHECK (codalumno ~ '^[A-Za-z0-9]+$'));
CREATE UNIQUE INDEX students_codalumno_unique ON students (lower(codalumno));
CREATE INDEX students_user_id_idx ON students (user_id);
-- teachers: same minus codalumno + index
```

## Roles / Permissions

`ROLE_PERMISSIONS.teacher = Object.freeze([...])` matching `<resource>:<action>` naming. Mapping `students↔estudiante`, `teachers↔teacher` is by domain concept; login derives permissions from role.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | pg-user/patient repo | shift `$n` params (audit columns, `lower`); assert updated null; toJSON excludes audit |
| Unit | pg-student/teacher repo | fake pool asserts exact params; `findByCodalumno` lower match; `create` accepts `client` |
| Unit | CreateStudent/Teacher | create-or-link by username/email/none; 400 (missing/codalumno/email); 409 dup; actor pass-through |
| Unit | authenticate | `sub`/`userId` surfaced; absent when token has no `sub` |
| Unit | permissions | teacher role non-empty + naming regex |
| Integration | new tables + FK order | shared cleanup `students→teachers→patients→users` (cross-file race); new alta/link/409 tests |
| Integration | repro | real `authenticate` middleware sets `created_by` (replaces stub-middleware test) |

## Migration / Rollout

`004` applies via existing migrate.ts (transactional, recorded in `schema_migrations`), no backfill. Rollback: `005_rollback.sql` (DROP tables, DROP COLUMN audit) or revert commit — data-safe.

## >400-line & PR Slicing

Spans 2 new modules + auth/patients/infra + tests → **exceeds 400 lines (High risk)**. Recommend **chained PRs**: (1) migration + auth/patients audit surface & their unit tests; (2) students module + tests; (3) teachers module + tests; (4) index wiring + integration FK order + real-middleware actor test. Each independently verifiable; child targets previous PR branch.

## Open Questions

- **codalumno format aligned**: design and spec STU-003 both now require pure `[A-Za-z0-9]+` (no hyphens/separators); reconciled before apply.
- `teacher` permission list values TBD (mirror shape only).
