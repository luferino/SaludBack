# Proposal: Multi-Role Schema (Students & Teachers) with Audit Columns

## Intent

The backend models one business actor (`patients`) plus `users` as access accounts, yet the school domain needs students (`estudiante`) and teachers with their own profile data. Today that data has nowhere to live, roles stop at `estudiante`, and audit attribution is dead: `created_by` exists on `patients` but `authenticate` never surfaces the token `sub` (PAT-004 gap), so the actor seam always yields null. This change adds a multi-role schema with uniform audit columns and makes attribution real.

## Scope

### In Scope
- Migration `004_multi_role_and_audit.sql`: add audit columns to `users`/`patients`; create `students` (`id` UUID PK, `user_id` FK→users, `nombres`, `apellidos`, `codalumno`) and `teachers` (`id` UUID PK, `user_id` FK→users, `nombres`, `apellidos`).
- Audit convention on all business tables: `created_by` (FK users), `created_at` (DEFAULT now()), `updated_by` (FK users), `updated_at`. `users.created_by` stays NULL (no admin flow; register remains OpenGuard).
- PAT-004 fix: `authenticate` surfaces `sub`/`userId` on `req.auth`; `AuthenticatedRequest` gains `sub?`/`userId`; `defaultGetActor` seam fixed.
- New: `Student`/`Teacher` entities, `StudentRepositoryPort`/`TeacherRepositoryPort`, `CreateStudent`/`CreateTeacher` use cases, `pg-student.repository.ts`/`pg-teacher.repository.ts` (thin positional-`$n` mappers mirroring pg-patient), `student.routes.ts`/`teacher.routes.ts`, wiring in `src/index.ts`.
- `ROLE_PERMISSIONS` gains a teacher role. Explicit naming mapping: table `students` ↔ role `estudiante` (existing, kept); table `teachers` ↔ role `teacher` (new claim). Mapping is by domain concept, not string match; specs MUST pin it.
- Extend `pg-user.repository.ts` (add `created_by` + audit) and `pg-patient.repository.ts` (add `updated_by`/`updated_at`).
- Tests: repo/SQL contract tests updated in lockstep (audit columns shift `$n` slots); integration FK delete-order becomes `students → teachers → patients → users` (cross-file race); new integration tests for both tables; replace the stub-middleware actor test with the real `authenticate` middleware (PAT-004).

### Out of Scope
- NOT renaming `patients` → `persons`; NOT switching UUID PKs to bigserial.
- NOT exposing `updated_at`/`updated_by` in entity `toJSON`/API responses (PAT-006 11-key contract stable).
- `password_reset_tokens` untouched (only `created_at`; atomic create CTE preserved).
- No admin role/flow yet; no UPDATE use cases (columns exist, update flows deferred); no self-registration, profile endpoints, or login changes.

## Capabilities

### New Capabilities
- `student-registration`: create students with codalumno, `user_id` linking, audit columns.
- `teacher-registration`: create teachers with `user_id` linking, audit columns.
- `audit-trail`: audit-column convention across business tables; `password_reset_tokens` exempt; `updated_*` never serialized.

### Modified Capabilities
- `patient-registration`: PAT-004 becomes real (sub surfaced); patients gain `updated_*` internally; response contract unchanged.
- `user-accounts`: users gain audit columns; email rules unchanged.
- `user-auth`: token verification exposes `sub` on `req.auth`.
- `user-registration`: still creates a bare user, role `estudiante`, `created_by` NULL; MUST NOT create a `students` row.

## Approach

Additive plain-SQL migration `004` (own transaction, lexical after `003`, non-idempotent per migrate.ts convention). Repos mirror the pg-patient pattern (duck-typed pool, `rowToX` helpers). PAT-004 copies `decoded.sub` into `req.auth.sub`/`userId`. New routes mount open with guard/actor seams (patients precedent); `toJSON` whitelists keep audit internals out of responses.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/db/migrations/004_multi_role_and_audit.sql` | New | Audit columns + students/teachers tables |
| `src/modules/auth/infrastructure/middleware/authenticate.ts` | Modified | Surface `sub`/`userId` |
| `src/modules/auth/domain/permissions.ts` | Modified | `teacher` role in ROLE_PERMISSIONS |
| `src/modules/auth/domain/user.entity.ts` | Modified | Audit fields; toJSON stable |
| `src/modules/auth/infrastructure/repositories/pg-user.repository.ts` | Modified | `created_by` + audit SQL/params |
| `src/modules/patients/domain/patient.entity.ts` | Modified | `updated_*` fields; 11-key toJSON unchanged |
| `src/modules/patients/infrastructure/repositories/pg-patient.repository.ts` | Modified | Audit columns in SQL/params |
| `src/modules/patients/infrastructure/routes/patient.routes.ts` | Modified | `defaultGetActor` fixed |
| `src/modules/students/**`, `src/modules/teachers/**` | New | Entity, ports, use case, repo, routes |
| `src/index.ts` | Modified | Mount `/students`, `/teachers` |
| `tests/unit/*`, `tests/integration/*` | Modified | Contract lockstep, FK order, actor test |

## Risks & Open Items

| Risk / Open item | Likelihood | Mitigation |
|------------------|------------|------------|
| Audit columns shift positional `$n` params → wrong-column writes | Med | Contract tests updated in lockstep; per-repo diff review |
| FK delete-order races across integration files (new FKs to users) | Med | Shared order students→teachers→patients→users |
| `updated_*` leaking into API responses | Low | toJSON whitelist + exact-key contract tests (PAT-006) |
| Non-idempotent migration applied twice | Low | schema_migrations records 004; additive SQL only |
| Role/table naming confusion | Med | Explicit mapping above; specs pin claim value |
| Diff likely exceeds 400-line review budget | High | Tasks phase plans chained PRs per module |
| `codalumno`: UNIQUE? required? format? | — | Specs decide |
| Does `POST /students` require an existing `user_id` or create the access account too? | — | Specs decide |
| `students`/`teachers` carry no email/celular today — confirm | — | Specs decide |

## Rollback Plan

Migrations are additive and non-idempotent: revert via a `005_rollback.sql` (DROP TABLE students/teachers; ALTER TABLE ... DROP COLUMN on users/patients) or restore a pre-change snapshot. Code: revert the commit — no contract break since PAT-006 bodies and auth responses are unchanged. No backfill runs, so downgrade is data-safe.

## Dependencies

- None external. Prereq: migration `003` applied; single shared test DB (FK-order discipline). No new env vars or dependencies.

## Success Criteria

- [ ] `pnpm test` green: unit + integration incl. new repositories/routes
- [ ] `004` applies clean on an empty DB; `schema_migrations` records it
- [ ] `POST /students` and `/teachers` persist with correct `created_by`/`created_at`
- [ ] Patient response keeps exactly the 11 PAT-006 keys; no `updated_*` in any response
- [ ] `authenticate` exposes `sub`; real-middleware actor test passes
- [ ] Full suite runs as one without FK races