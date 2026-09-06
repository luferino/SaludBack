# Tasks: Multi-Role Schema (Students & Teachers) with Audit Columns

## Review Workload Forecast

~1700 changed lines, High risk; chained PRs recommended (4 verifiable slices).

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Work Units (chained PR slices)

PR 1 ← Phase 1 (base main/tracker, ask user); PR 2 ← Phase 2 (base PR 1); PR 3 ← Phase 3 (base PR 2); PR 4 ← Phase 4 (base PR 3).

Reconciled: `codalumno` pure `^[A-Za-z0-9]+$` (STU-003); create-or-link for students AND teachers (STU-002/TEA-002). Mnemonics (unnamed delta reqs): UAC-001/002, AUTH-001/002, REG-001.

## Phase 1: Migration + Audit Surface (PR 1)

- [x] 1.1 RED `tests/unit/pg-user-repository.test.js`: `$n` shift + `created_by` NULL (UAC-001 REG-001)
- [x] 1.2 RED `tests/unit/authenticate.test.js`: `req.auth.sub`/`userId`; absent without `sub` (AUTH-002 PAT-004)
- [x] 1.3 RED `tests/unit/permissions.test.js`: `teacher` role valid (AUTH-001)
- [x] 1.4 RED `tests/unit/pg-patient-repository.test.js` + patient toJSON: `updated_*` NULL/unsent (PAT-007 AUD-002)
- [x] 1.5 GREEN `src/db/migrations/004_multi_role_and_audit.sql`: audit cols users/patients; students/teachers; codalumno CHECK + lower unique (AUD-001 STU-003)
- [x] 1.6 GREEN `src/modules/auth/domain/user.entity.ts`: audit fields; toJSON excludes (UAC-001 AUD-002)
- [x] 1.7 GREEN `auth.ports.ts` + `pg-user.repository.ts`: USER_COLUMNS + insert `created_by` NULL (UAC-001)
- [x] 1.8 GREEN `middleware/authenticate.ts`: `AuthenticatedRequest` `sub?`/`userId?`; copy `decoded.sub` (AUTH-002)
- [x] 1.9 GREEN `permissions.ts`: add `teacher` role (AUTH-001)
- [x] 1.10 GREEN `patient.entity.ts` + `pg-patient.repository.ts`: `updated_*` internal; 11-key toJSON stable (PAT-007)
- [x] 1.11 GREEN `patient.routes.ts` `defaultGetActor`: `req.auth.userId ?? sub` (PAT-004)
- [x] 1.12 Verify: `pnpm db:migrate` applies 004; `node --import tsx --env-file=.env.test --test tests/unit/` green

## Phase 2: Students Module (PR 2)

- [x] 2.1 RED `tests/unit/create-student.test.js`: 400/409/link/create/actor (STU-001..005 UAC-002)
- [x] 2.2 GREEN `shared/application/unit-of-work.ts` + `shared/infrastructure/pg-unit-of-work.ts`: `withTransaction` (BEGIN/COMMIT/ROLLBACK)
- [x] 2.3 GREEN `auth.ports.ts`/`pg-user.repository.ts` `create`: optional `client?: Queryable`
- [x] 2.4 GREEN students `student.entity.ts`, `student.ports.ts`, `create-student.usecase.ts`: validate→`^[A-Za-z0-9]+$`→dup 409→create-or-link→tx + 8-key toJSON (STU-001..005 AUD-003)
- [x] 2.5 GREEN `students/infrastructure/repositories/pg-student.repository.ts`: `findByCodalumno` lower, `create(student, client?)` (STU-003)
- [x] 2.6 GREEN `students/infrastructure/routes/student.routes.ts`: `POST /students` OpenGuard + actor seam (STU-005)
- [x] 2.7 Verify `tests/integration/students.test.js` (own app): alta/link/409/400/contract/actor (STU-001..005 UAC-002 AUD-003)

## Phase 3: Teachers Module (PR 3)

- [x] 3.1 RED `tests/unit/create-teacher.test.js`: 400/link/create/actor (TEA-001 TEA-002 TEA-004 UAC-002)
- [x] 3.2 GREEN teachers `teacher.entity.ts`, `teacher.ports.ts`, `create-teacher.usecase.ts`: mirror (no codalumno); 7-key toJSON (TEA-001 TEA-002 AUD-003)
- [x] 3.3 GREEN `teachers/infrastructure/repositories/pg-teacher.repository.ts`: `create(teacher, client?)` (TEA-001)
- [x] 3.4 GREEN `teachers/infrastructure/routes/teacher.routes.ts`: `POST /teachers` OpenGuard + actor seam (TEA-004)
- [x] 3.5 Verify `tests/integration/teachers.test.js` (own app) (TEA-001..004 UAC-002 AUD-003)

## Phase 4: Wiring + Integration Hardening (PR 4)

- [x] 4.1 GREEN `src/index.ts`: UOW + repos; mount `/students` `/teachers`
- [x] 4.2 Update cleanup `tests/integration/auth.test.js` + `patients.test.js` (+new): order students→teachers→patients→users (AUD-001)
- [x] 4.3 Replace stub with real `authenticate` in `patients.test.js`: valid→`created_by`=sub; malformed→201+NULL (PAT-004)
- [x] 4.4 Extend `tests/integration/auth.test.js`: teacher claims role/permissions/sub + register audit NULL + no students row (AUTH-001 REG-001 UAC-001)
- [x] 4.5 Verify: full `pnpm test` (pretest migrates) as ONE run, no FK races

## Notes

Runner `node --import tsx --env-file=.env.test --test`; unit/integration separate during apply (cross-file hang); full suite once at 4.5. Rollback: `005_rollback.sql`.