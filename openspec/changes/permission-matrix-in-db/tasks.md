# Tasks: Permission Matrix in the Database

## Slice / PR Plan

| Slice | Scope | PR boundary | Green gate |
|-------|-------|-------------|------------|
| ① Core | Migrations 006/007, `PermissionMatrixReader` port, `PgPermissionMatrixRepository`, sweep of `permissions.ts`, wiring, unit rework | PR 1 | Migrations apply on fresh DB + idempotent re-run; full `pnpm test` (serial) |
| ② Integration | cleanDb reseed, fixture rework (`setRolePermissions`, DB-derived `seedAdmin`, retire `tokenForRolePermissions`), integration suites | PR 2 | Full `pnpm test` (serial); DB-wins proven end-to-end |
| ③ Spec cleanups + leftover | profile-read Purpose fix, delta baseline sync, leftover units | PR 3 | Full `pnpm test`; zero matrix-constant refs in `src/`/`tests/` |

Chain strategy: **pending decision** (stacked-to-main vs feature-branch-chain) — user confirms before apply; not decided here.

## Tasks

### Slice ① — Core (PR 1)

- [x] 1.1 [PG-001] `src/db/migrations/006_create_permission_matrix.sql`: `permissions` catalog + `role_permissions` grants (PK `(role, permission)`), 005-house-style header (purpose/rollback/re-apply).
- [x] 1.2 [PG-001, Token Claims Contract] `src/db/migrations/007_seed_permission_matrix.sql`: seed 7 catalog rows (5 enforced, 2 inert) + 13 grants (estudiante/teacher → 3, admin → 7).
- [x] 1.3 [PG-001] Verify: `pnpm db:migrate` applies 006/007 on a fresh DB; re-run is a no-op ("Skipping", once-only transactional).
- [x] 1.4 [Token Claims Contract, Token Verification] `src/modules/auth/application/auth.ports.ts`: add async port `PermissionMatrixReader { permissionsForRole(role): Promise<readonly string[]> }`.
- [x] 1.5 [PG-001, Token Verification] `src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts` (new): pool-injected point query `WHERE role = $1 ORDER BY permission`; empty → `[]`.
- [x] 1.6 [PG-001] `tests/unit/pg-permission-matrix.repository.test.js` (new): fake-pool house pattern — SQL/params, row mapping, empty → `[]`.
- [x] 1.7 [Token Verification] `src/modules/auth/infrastructure/middleware/authenticate.ts`: `authenticate(tokenService, matrixReader)`; derive `req.auth.permissions` outside verify catch; claim ignored, no backfill; matrix failure → `next(error)` (500, not 401).
- [x] 1.8 [Token Verification] `tests/unit/authenticate.test.js`: fakeReader in all constructions; DB-wins inverts claim-wins; backfill tests → claim ignored; new fail-closed test (non-`UnauthorizedError` forwarded).
- [x] 1.9 [Token Claims Contract] `src/modules/auth/application/login-user.usecase.ts`: constructor gains `matrixReader`; sign `permissions: await matrixReader.permissionsForRole(role)`.
- [x] 1.10 [Token Claims Contract] `tests/unit/login-user.test.js`: fake reader; assert fake's return; matrix failure propagates.
- [x] 1.11 [Token Claims Contract] `src/modules/auth/infrastructure/routes/auth.routes.ts`: `AuthRouterDeps` + `LoginUser` gain required `matrixReader`.
- [x] 1.12 [Token Verification, PG-003] `src/app.ts`: one matrix instance; inject into `createAuthRouter` + 5 `authenticate` mounts (register, /me, patients, students, teachers).
- [x] 1.13 [Token Verification, PG-003] Compat (sweep consumers): `tests/integration/auth.test.js` — 3 construction sites gain real `PgPermissionMatrixRepository(pool)`, `ROLE_PERMISSIONS` → seeded literals (L16/L309); `tests/integration/helpers/admin-token.js` — `seedAdmin` perms → seeded admin literal.
- [x] 1.14 [PG-001] Sweep: delete `src/modules/auth/domain/permissions.ts` + `tests/unit/permissions.test.js` (PG-001 coverage moves to migrations/repo/wiring suites).
- [x] 1.15 [Token Claims Contract] `tests/unit/jwt-token-service.test.js`: `CLAIMS` fixture → local literal (service is matrix-agnostic).
- [x] 1.16 Verify slice ①: full `pnpm test` green (serial). 24/24 unit green; 32 integration failures expected (Slice 2 scope — matrixReader missing in fixtures).

### Slice ② — Integration (PR 2)

- [x] 2.1 [PG-001] `tests/integration/helpers/clean-db.js`: after FK-safe deletes, `TRUNCATE role_permissions, permissions`; re-execute `007_seed_permission_matrix.sql` from disk; update reseed-contract comment (migration file = mirror; grant changes edit 007 in same change).
- [x] 2.2 [PG-001, PG-003] `tests/integration/helpers/admin-token.js`: add `setRolePermissions(pool, role, permissions)` — replace-all (DELETE + INSERT), order-independent.
- [x] 2.3 [PG-003] `admin-token.js`: `seedAdmin` derives the claim via `SELECT permission FROM role_permissions WHERE role = 'admin'` (replaces 1.13 literal).
- [x] 2.4 [PG-003] `admin-token.js`: retire `tokenForRolePermissions`; `seedUserWithPermissions` calls `setRolePermissions`; `tokenForRole`/`expiredTokenForRole` unchanged.
- [x] 2.5 [Token Claims Contract] `tests/integration/auth.test.js`: L309 asserts seeded teacher grants (SELECT or 3-literal); `/secure` echo expects DB-derived set + 2 inert; fresh-login-reflects-matrix scenario.
- [x] 2.6 [PG-001, Token Verification] `tests/integration/wiring.test.js`: role denies unchanged; admin deny via `setRolePermissions` restored in try/finally; grant-removed → 403 next request; grant-added honored; unknown role 403; matrix failure → 500.
- [x] 2.7 [STU-005] `tests/integration/students.test.js`: matrix-backed allow/deny proofs; admin 201 + `created_by` unchanged.
- [x] 2.8 [TEA-004] `tests/integration/teachers.test.js`: matrix-backed rework (as 2.7).
- [x] 2.9 [PAT-005] `tests/integration/patients.test.js`: matrix-backed rework (as 2.7).
- [x] 2.10 Verify slice ②: full `pnpm test` green (serial); cleanDb comment updated.

### Slice ③ — Spec cleanups + leftover (PR 3)

- [x] 3.1 [PR-001] `openspec/specs/profile-read/spec.md`: Purpose fix — "granted by `ROLE_PERMISSIONS`" → seeded `role_permissions` grants.
- [x] 3.2 Baseline sync: six delta baselines (`user-auth`, `permission-guards`, `user-registration`, `student-registration`, `teacher-registration`, `patient-registration`) — direct edits here vs archive sync (design open question; pick and apply).
- [x] 3.3 Sweep audit: `grep ROLE_PERMISSIONS|IMPLEMENTED_PERMISSIONS|permissionsForRole` over `src/` + `tests/` → zero matches; land any deferred units from ①/②.
- [x] 3.4 Verify slice ③: full `pnpm test` green (serial); audit clean.