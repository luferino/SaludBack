# Verification Report — profile-read-permission-guards

**Change**: profile-read-permission-guards
**Version**: delta specs `profile-read` (v1) + `permission-guards` (v1) + `user-registration` (delta) + `student-registration` (delta: STU-005 modified, STU-006 added) + `teacher-registration` (delta: TEA-004 modified, TEA-005 added) + `patient-registration` (delta: PAT-005 modified)
**Mode**: Standard (strict_tdd: false)
**Date**: 2026-09-20
**Verifier**: independent, fresh-context (sdd-verify executor)
**Branch verified**: `main` @ `385e2c5` (two doc-only commits on top of the implementation: `5b894e1` artifacts, `385e2c5` stale-wording/SQL-sketch fixes from the prior adversarial review)

---

## Summary

`GET /auth/me` (fresh PK read, exactly `{username, email, role}`), the `PermissionGuard` policy seam, the pinned permission matrix, the four write-mount guard swaps, and migration 005 (guarded UNIQUE constraints on `students.user_id` / `teachers.user_id`) are all implemented, wired, and proven by a green full suite. Independent run of `pnpm test`: **303 passed / 0 failed / 0 skipped**. DB state reconfirmed directly: `schema_migrations` contains `001`–`005` and both UNIQUE constraints exist on the test database. All 14 requirements / 36 scenarios verified; 34 COMPLIANT with passing covering tests, 2 PARTIAL (per-mount expired-token literal coverage for `/teachers` and `/patients`, mechanism proven on the shared middleware via other mounts). No CRITICAL, no WARNING-level behavior gaps. **READY_FOR_ARCHIVE**.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 17 |
| Tasks complete | 17 (1.1–1.11, 2.1–2.4, 3.1–3.2, all `[x]`) |
| Tasks incomplete | 0 |

`tasks.md` checkboxes verified by inspection; every task maps to implementation artifacts and passing tests below (no unchecked implementation tasks).

## Build & Tests Execution

**Pretest (migration hook)**: ✅ Passed
```text
> tsx --env-file=.env.test src/db/migrate.ts
Skipping 001_create_users.sql (already applied)
Skipping 002_create_patients.sql (already applied)
Skipping 003_add_email_and_reset_tokens.sql (already applied)
Skipping 004_multi_role_and_audit.sql (already applied)
Skipping 005_user_id_unique_profiles.sql (already applied)
Migrations finished. Applied 0 new file(s).
```

**Tests** (`pnpm test` = `pretest` + `node --import tsx --env-file=.env.test --test --test-concurrency=1`): ✅ **303 passed / 0 failed / 0 skipped**
```text
ℹ tests 303
ℹ suites 0
ℹ pass 303
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 67409.4723
```

**DB version reconfirmed (direct query against `saludback_test`, not inferred)**: `schema_migrations` = `001_create_users.sql, 002_create_patients.sql, 003_add_email_and_reset_tokens.sql, 004_multi_role_and_audit.sql, 005_user_id_unique_profiles.sql`; `information_schema.table_constraints` reports both `students_user_id_unique` (students) and `teachers_user_id_unique` (teachers) present.

**Build**: N/A — plain ESM Node app (tsx runtime), no build step. **Coverage**: ➖ Not configured (no coverage tooling in `package.json`).

## Spec Compliance Matrix (independent trace)

Every scenario below was traced to a test that **passed in my own run of `pnpm test`**. 14 requirements, 36 scenarios: **34 COMPLIANT, 2 PARTIAL, 0 UNTESTED, 0 FAILING**.

### profile-read spec — 6 scenarios, 6 COMPLIANT

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| PR-001 Happy path (200, exactly `username`/`email`/`role`) | unit `get-current-user.test.js` > `returns exactly username, email and role for an existing user (PR-001)` (deepEqual 3 keys, `passwordHash`/`id`/`createdBy` absent); integration `auth.test.js` > `GET /auth/me reads the email fresh from the database, not from token claims (PR-001)` (200, exact 3-key body for a real `estudiante`) | ✅ COMPLIANT |
| PR-001 Fresh database read, not token claims | integration > `GET /auth/me reads the email fresh from the database, not from token claims (PR-001)` (token minted with `old@example.com`, row updated to `new@example.com`, response shows `new@example.com`) | ✅ COMPLIANT |
| PR-001 Account without a profile | integration > `GET /auth/me returns exactly username, email and role for the profile-less admin (200, PR-001)` (bootstrapped admin, `email: null`, exactly 3 keys, no profile payload); unit > `keeps email null for an account without an email (profile-less admin shape)` | ✅ COMPLIANT |
| PR-002 No token rejected (401, read does not execute) | integration > `GET /auth/me without a token is rejected with 401 and the read does not run (PR-002)` (401 `UNAUTHORIZED`, message `Invalid or missing token`); unit > `throws UnauthorizedError (401) without touching the database when no user id is present` (reads counter = 0) | ✅ COMPLIANT |
| PR-002 Missing permission rejected (403) | integration > `GET /auth/me rejects a verified token without profile:read with 403 (PR-002)` (role admin, perms `['users:write']` → 403 `FORBIDDEN`) | ✅ COMPLIANT |
| PR-002 Unknown subject rejected (401) | integration > `GET /auth/me rejects a verified token whose userId matches no row with 401 (PR-002)` (valid UUID, no row → 401); integration > `...non-UUID sub with 401, not 500 (PR-002)` + unit > `throws UnauthorizedError (401) for a UUID-shaped but invalid sub, with no DB read (PR-002)` (malformed identity rejected before DB read — no 22P02/500) | ✅ COMPLIANT |

### permission-guards spec — 7 scenarios, 7 COMPLIANT

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| PG-001 Admin owns every write permission | unit `permissions.test.js` > `every implemented permission is granted to the admin role (PG-001)` + `admin role maps to an explicit management permission set` (4 writes + `profile:read` in `ROLE_PERMISSIONS.admin`) | ✅ COMPLIANT |
| PG-001 Inert claims never enforced | unit > `inert claims (materias:read / turnos:read) are never part of the implemented set (PG-001)`; integration `wiring.test.js` > `a token holding only an inert claim is denied on all four write mounts (PG-003 mapping discrimination)` (403 on register/students/teachers/patients) | ✅ COMPLIANT |
| PG-002 Unauthenticated rejected (401, handler does not run) | unit `guard.test.js` > `PermissionGuard rejects a request with no req.auth as UnauthorizedError (401)`; integration wiring > 401 without token on all five mounts (`/auth/me`, register, students, teachers, patients) | ✅ COMPLIANT |
| PG-002 Missing permission rejected (403, handler does not run) | unit > `PermissionGuard rejects a request missing the required permission with ForbiddenError (403)` (empty, other-perm, inert-claim sets); integration wiring > PG-003 deny-side asserts `rows 0` persisted (e.g. `POST /students ... students handler must not run when students:write is missing`) | ✅ COMPLIANT |
| PG-002 Permission present proceeds | unit > `PermissionGuard allows a request whose permissions include the required permission` + `PermissionGuard enforces exactly the configured permission, not any other`; integration wiring > allow-side tokens reach the handler (201s) | ✅ COMPLIANT |
| PG-003 Admin preserved on every mount | integration wiring > register 201, students 201, teachers 201, patients 201, `GET /auth/me` 200 with the admin token (`...mounts GET /auth/me behind authenticate + PermissionGuard (401/200, PR-001)` and the four `(401/403/201)` mount tests) | ✅ COMPLIANT |
| PG-003 Non-admin write mount rejected (nothing persisted) | integration wiring > `POST /students` with a `teacher` token → 403 `FORBIDDEN`; unit router tests `an attached guard rejects the request before the use case runs (STU-005)` / `(TEA-004)` | ✅ COMPLIANT |

### user-registration spec (delta) — 4 scenarios, 4 COMPLIANT

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| No token rejected (401, use case not executed) | integration `auth.test.js` > `POST /auth/register without a token is rejected with 401` (401 `UNAUTHORIZED`); shared `authenticate` middleware raises exactly `Invalid or missing token` before any handler (unit `authenticate.test.js` > `missing Authorization header rejects with 401 and does not call verify`) | ✅ COMPLIANT |
| Expired token rejected (401, message `Invalid or missing token`) | integration wiring > `an expired token is rejected with 401 on the real protected wiring (POST /auth/register)` (401, message, `rows 0` — handler never ran) | ✅ COMPLIANT |
| Token without `users:write` rejected (403) | integration wiring > `POST /auth/register enforces users:write, not the admin role (PG-003)` (admin-role token without `users:write` → 403; `PERMREG1` row count 0) | ✅ COMPLIANT |
| Admin token still accepted (201, `estudiante` persisted) | integration auth > `POST /auth/register creates an estudiante with a bcrypt hash and email` (201, role `estudiante`, row persisted) | ✅ COMPLIANT |

### student-registration spec (delta) — 8 scenarios, 8 COMPLIANT

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| STU-005 Missing token rejected (401, nothing persisted) | integration `students.test.js` > `POST /students rejects a missing, garbage and non-admin token (401/401/403)`; wiring > students mount 401 no-token | ✅ COMPLIANT |
| STU-005 Token without `students:write` rejected (403, nothing persisted) | integration wiring > 403 for teacher token on `/students`; PG-003 deny-side asserts `students` row count 0 | ✅ COMPLIANT |
| STU-005 Actor from verified token (`created_by` = sub on account + students rows) | integration wiring > `POST /students` test asserts `body.created_by === adminId` and `users.created_by === adminId` (admin sub `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`, the spec's example subject) | ✅ COMPLIANT |
| STU-005 Expired token rejected (401, nothing persisted) | integration wiring > `an expired token is rejected with 401 on a real alta endpoint (POST /students)` (401, message `Invalid or missing token`, `codalumno` row count 0) | ✅ COMPLIANT |
| STU-005 Admin token still accepted (201, exactly one user + one students row) | integration wiring > students mount: 201, `users.length === 1`, `students.length === 1` | ✅ COMPLIANT |
| STU-006 Clean data migrates (constraint applied) | integration `migration-precheck.test.js` > `clean data: migration 005 applies both UNIQUE constraints and re-runs idempotently` (real migrate runner: applies, records `schema_migrations` row, idempotent re-run skips) | ✅ COMPLIANT |
| STU-006 Duplicates abort before DDL, listing user_id + ids, no auto-repair | integration > `duplicate students.user_id aborts the migration before any DDL, listing user_id and profile ids (STU-006)` (exit 1, error lists `user_id -> {ids}`, constraints absent, no `schema_migrations` row, both dup rows still present) + `duplicates across two distinct students.user_id values list EVERY affected group (STU-006)` | ✅ COMPLIANT |
| STU-006 Second profile impossible (23505) | integration > `a second students row for the same user_id is rejected with 23505 (STU-006)` (`23505`, constraint `students_user_id_unique`, row count stays 1) | ✅ COMPLIANT |

### teacher-registration spec (delta) — 8 scenarios, 7 COMPLIANT, 1 PARTIAL

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| TEA-004 Missing token rejected (401, nothing persisted) | integration `teachers.test.js` > `POST /teachers rejects a missing, garbage and non-admin token (401/401/403)`; wiring > teachers mount 401 no-token | ✅ COMPLIANT |
| TEA-004 Token without `teachers:write` rejected (403, nothing persisted) | integration wiring > 403 for `estudiante` token on `/teachers`; PG-003 deny-side asserts 0 rows | ✅ COMPLIANT |
| TEA-004 Actor from verified token | integration wiring > teachers mount asserts `body.created_by === adminId` and `users.created_by === adminId` | ✅ COMPLIANT |
| TEA-004 Expired token rejected (401, nothing persisted) | ⚠️ PARTIAL — no test literally sends an expired token to `POST /teachers`. The rejection lives entirely in the shared `authenticate` middleware instance wired to this mount (`src/app.ts` `authenticate(tokenService)` before `createTeacherRouter`), and that exact middleware is proven expired→401 with handler-not-run on `/auth/register`, `/students` (wiring), `/auth/me` (auth.test) and the generic `/secure` route (auth.test `protected route rejects missing, malformed and expired tokens with 401`). Mechanism identical by construction; per-mount literal coverage missing. | ⚠️ PARTIAL |
| TEA-004 Admin token still accepted (201, exactly one user + one teachers row) | integration wiring > teachers mount: 201, `users.length === 1`, `teachers.length === 1` | ✅ COMPLIANT |
| TEA-005 Clean data migrates | integration migration-precheck > `clean data: migration 005 applies both UNIQUE constraints and re-runs idempotently` (teachers constraint asserted via `constraintExists`) | ✅ COMPLIANT |
| TEA-005 Duplicates abort before DDL, listing user_id + ids, no auto-repair | integration > `duplicate teachers.user_id aborts the migration before any DDL, listing user_id and profile ids (TEA-005)` (exit 1, stderr lists `user_id -> {ids}`, both ALTERs absent — pre-DDL abort, dup rows untouched) | ✅ COMPLIANT |
| TEA-005 Second profile impossible (23505) | integration > `a second teachers row for the same user_id is rejected with 23505 (TEA-005)` (`23505`, constraint name asserted, row count stays 1) | ✅ COMPLIANT |

### patient-registration spec (delta) — 3 scenarios, 2 COMPLIANT, 1 PARTIAL

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| PAT-005 Expired token rejected (401, no patient created) | ⚠️ PARTIAL — same gap as TEA-004: no literal expired-token request against `POST /patients`; identical shared-`authenticate` mechanism proven on three other mounts (see TEA-004 row). | ⚠️ PARTIAL |
| PAT-005 Token without `patients:write` rejected (403, no patient created) | integration wiring > 403 for teacher token on `/patients`; PG-003 deny-side asserts `patients` row count 0 | ✅ COMPLIANT |
| PAT-005 Admin token still accepted (201, row persisted) | integration wiring > patients mount: 201, `body.documento === '99999999'`, `created_by === adminId` | ✅ COMPLIANT |

**Compliance summary**: **34/36 COMPLIANT, 2 PARTIAL, 0 UNTESTED, 0 FAILING** across 6 delta specs.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| PR-001 `findById` port + repo | ✅ Implemented | `UserRepositoryPort.findById(userId): Promise<User\|null>`; `PgUserRepository.findById` = `SELECT USER_COLUMNS FROM users WHERE id = $1` → `rowToUser`, null on empty; unit tests assert SQL shape, params, mapping, null. |
| PR-001 `GetCurrentUser` use case | ✅ Implemented | Narrow `CurrentUserOutput {username, email, role}`; null/missing/non-UUID subject → `UnauthorizedError('Invalid or missing token')`; JWT claims never enter payload; rejects malformed identities before the DB read (no 22P02 → 500). |
| PR-001 `GET /auth/me` mount | ✅ Implemented | `auth.routes.ts` mounts `/me` only when BOTH `meMiddleware` + `meGuard` provided; `app.ts` wires `authenticate(tokenService)` + `PermissionGuard('profile:read')`; userId resolved from `req.auth.userId ?? sub`. |
| PG-002 `PermissionGuard` | ✅ Implemented | `src/modules/shared/application/guard.ts`: extends `Guard`, mounted after `authenticate`, 401 when `req.auth` absent, 403 when permission missing from `req.auth.permissions`, exact-string match (inert claims never satisfy). |
| PG-001 Permission matrix | ✅ Implemented | `permissions.ts`: `IMPLEMENTED_PERMISSIONS` pinned to the 5 perms; `materias:read`/`turnos:read` stay inert in `ROLE_PERMISSIONS`; admin owns all 5. |
| PG-003 Protected route mapping | ✅ Implemented | `app.ts`: register → `users:write`, students → `students:write`, teachers → `teachers:write`, patients → `patients:write`, `/auth/me` → `profile:read`; `AdminGuard` import dropped (only `PermissionGuard` wired). Login + password recovery stay unauthenticated (verified by wiring test). |
| STU-006 / TEA-005 Migration 005 | ✅ Implemented | `005_user_id_unique_profiles.sql`: `DO $$` pre-check `RAISE EXCEPTION` listing `user_id -> {ids}` for students AND teachers, before any DDL; then `ADD CONSTRAINT ... UNIQUE (user_id)` on both tables; one transaction per file (raise rolls back DDL + skips `schema_migrations`); no auto-repair; rollback = `DROP CONSTRAINT`. Both constraints confirmed present on the test DB. |
| Register 401/403 semantics | ✅ Implemented | `authenticate` (401 `Invalid or missing token`) → `PermissionGuard('users:write')` (403 `FORBIDDEN`); expired-token wiring test proves handler never runs. |
| Admin token fixture | ✅ Implemented | `seedAdmin` derives `permissions` from `ROLE_PERMISSIONS.admin` (drift-proof; admin token carries `profile:read`). |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Guard mechanics: `PermissionGuard extends Guard`, `authorize(req)` in-handler after `authenticate` | ✅ Yes | Exact seam from design; use case never runs on rejection (deny-side row-count assertions). |
| Auth router deps: keep `guard` (register → `users:write`), add optional `meMiddleware` + `meGuard` | ✅ Yes | `/me` unmounted until wiring arms both; register handler untouched. |
| `findById` contract: full `USER_COLUMNS` select + `rowToUser` | ✅ Yes | Parity with `findByUsername`/`findByEmail`. |
| Sensitive-field exclusion: narrow `CurrentUserOutput`, `toJSON()` NOT reused | ✅ Yes | Design noted `toJSON()` exposes `id`/`createdAt`; use case returns exactly 3 keys. |
| Unknown subject: use case throws `UnauthorizedError` (401) | ✅ Yes | Policy in app layer, status/code is the contract. |
| Migration pre-check: `DO $$` inside 005 file, `RAISE EXCEPTION` lists dups, no auto-repair | ✅ Yes | Matches design sketch; rollback note on re-apply documented in the file. |
| Constraint style: `ADD CONSTRAINT ... UNIQUE (user_id)` | ✅ Yes | Naming mirrors `students_codalumno_unique`; rollback = DROP CONSTRAINT. |
| Admin token helper: `seedAdmin` derives perms from `ROLE_PERMISSIONS.admin` | ✅ Yes | Prevents drift; admin token carries `profile:read` for `/me` 200. |
| Wiring swaps only at `src/app.ts` | ✅ Yes | Routers keep `OpenGuard` default; policy injected at mount time. |

No design deviations found.

## Rollback / Non-goals Check

| Check | Result |
|-------|--------|
| `materias:read` / `turnos:read` not enforced | ✅ Inert claims; no guard requires them; token holding only an inert claim is denied on all four write mounts. |
| No profile-detail endpoints / no update / no self-registration / no token-format change | ✅ `GET /auth/me` is the only read added; response contract is 3 keys. |
| Migration additive; rollback = DROP CONSTRAINT (no data loss) | ✅ Documented in `005` header; pre-check aborts loudly with no auto-repair. |
| Known debt: 23505 in link path stays untranslated (500) — explicitly OUT OF SCOPE by user decision | ✅ Not introduced by this change; recorded in design Open Questions; `migration-precheck` proves DB-level rejection only. |
| Redundant `students_user_id_idx` / `teachers_user_id_idx` kept for rollback simplicity | ✅ Documented in `005` header (follow-up candidate only). |

## Work-Unit / Commit Quality

| Check | Result |
|-------|--------|
| Conventional commits, English | ✅ 10 implementation + 2 doc commits: `feat(shared)` `feat(auth)` `fix(auth)` `feat(db)` `test(integration)` `docs(db)` `docs(openspec)` — descriptive of outcome. |
| No AI attribution | ✅ `git log --format=%b` across the change range: no `Co-Authored-By` lines. |
| Tests travel with code | ✅ Unit suites land with their behavior commits; integration coverage in wiring/harness commits; migration test arrives with the migration. |
| Work-unit story | ✅ 3 chained-PR slices per design (A profile-read → B guards → C migration), merge-committed via PRs #16/#17. |
| Working tree clean | ✅ `git status --short` empty at verification time. |

## Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:
1. **Parameterize the expired-token 401 case across all five mounts** (TEA-004 / PAT-005 PARTIAL): `expiredTokenForRole` already exists in `tests/integration/helpers/admin-token.js`; the wiring suite exercises it on `/auth/register`, `/students` (and auth.test on `/auth/me`), but no test literally sends an expired token to `POST /teachers` or `POST /patients`. The rejection lives entirely in the shared `authenticate` middleware wired identically to all mounts, so behavior is proven by construction — a dedicated per-mount case (or looping the existing wiring tests over all the alta mounts) would close the literal gap.
2. **Known debt, out of scope (recorded in design)**: the untranslated 23505 → 500 on the create-student link path remains accepted debt per the 2026-09-18 user decision; only DB-level rejection is spec-required.

## Verdict

**PASS — READY_FOR_ARCHIVE**

- 17/17 tasks complete; `pnpm test` **303/303** green in an independent run (0 fail, 0 skipped), pretest confirmed migration 005 applied; direct DB query confirms migrations `001`–`005` and both UNIQUE constraints.
- 14/14 requirements and 34/36 scenarios COMPLIANT with passing covering tests; the 2 PARTIAL items are a per-mount literal test-coverage nuance on a provably shared middleware path, not a behavior gap.
- All design decisions followed; implementation artifacts (PermissionGuard, matrix, five mount mappings, GetCurrentUser, findById, migration 005) match specs and design.
- No CRITICAL or WARNING issues; only optional test-coverage and documented-debt suggestions.