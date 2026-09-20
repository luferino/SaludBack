# Tasks: Profile Read Endpoint & Permission-Driven Guards

## Review Workload Forecast

- Estimated changed lines: ~555–605 (A ~340, B ~130, C ~115)
- Suggested split: PR 1 (A) → PR 2 (B) → PR 3 (C), each to main
- Delivery strategy: ask-on-risk

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | A: GET /auth/me | PR 1 | Base main; carries PermissionGuard class + seedAdmin perms fix |
| 2 | B: matrix pin + guard swaps | PR 2 | Base main; depends on A; 4 write mounts -> permissions |
| 3 | C: migration 005 | PR 3 | Base main; independent; may merge parallel |

## Phase 1 — Slice A: Profile read (PR 1, base main)

- [x] 1.1 [PR-001] `src/modules/auth/application/auth.ports.ts`: add `findById(userId)` to `UserRepositoryPort`.
- [x] 1.2 [PR-001] `src/modules/auth/infrastructure/repositories/pg-user.repository.ts`: `findById` = PK select via USER_COLUMNS -> `rowToUser`; null when empty.
- [x] 1.3 [PR-001] `tests/unit/pg-user-repository.test.js`: findById tests (fake pool): SQL + params, row mapping, null.
- [x] 1.4 [PR-001/PR-002] `src/modules/auth/application/get-current-user.usecase.ts`: create `GetCurrentUser` -> `CurrentUserOutput {username,email,role}`; null -> `UnauthorizedError`.
- [x] 1.5 [PR-001/PR-002] `tests/unit/get-current-user.test.js`: exactly 3 keys (no hash/id/audit); null -> 401.
- [x] 1.6 [PG-002] `src/modules/shared/application/guard.ts`: add `PermissionGuard(perm)` — 401 no `req.auth`, 403 perm missing, else proceed. Needed by /me (A) and swaps (B).
- [x] 1.7 [PG-002] `tests/unit/guard.test.js`: PermissionGuard 401/403/allow cases.
- [x] 1.8 [PR-001] `src/modules/auth/infrastructure/routes/auth.routes.ts`: optional `meMiddleware`/`meGuard`; `GET /me`: middleware -> guard -> GetCurrentUser(userId from req.auth) -> 200.
- [x] 1.9 [PR-001/PG-003] `tests/integration/helpers/admin-token.js`: `seedAdmin` derives perms from `ROLE_PERMISSIONS.admin` (admin token needs `profile:read` for /me 200).
- [x] 1.10 [PR-001] `src/app.ts`: wire `meMiddleware: authenticate(tokenService)`, `meGuard: new PermissionGuard('profile:read')`; register keeps `AdminGuard`.
- [x] 1.11 [PR-001/PR-002] `tests/integration/auth.test.js`: /me 200 exact 3 keys; 401 no-token/expired/unknown-subject; 403 no `profile:read`; email UPDATE -> fresh value; admin (email null) 200.

## Phase 2 — Slice B: Permission guards (PR 2, base main)

- [x] 2.1 [PG-001] `src/modules/auth/domain/permissions.ts`: export `IMPLEMENTED_PERMISSIONS` (5 perms); `materias:read`/`turnos:read` stay inert.
- [x] 2.2 [PG-001] `tests/unit/permissions.test.js`: admin owns 4 writes + `profile:read`; pin list; inert claims never enforced.
- [x] 2.3 [PG-003] `src/app.ts`: swap guards — register `users:write`; students/teachers/patients -> own write perm; drop `AdminGuard` import.
- [x] 2.4 [PG-002/PG-003] `tests/integration/wiring.test.js`: 5 mounts — 401 no-token / 403 non-admin / admin 201x4 + /me 200; expired 401.

## Phase 3 — Slice C: Migration (PR 3, base main; parallel-mergeable)

- [x] 3.1 [STU-006/TEA-005] `src/db/migrations/005_user_id_unique_profiles.sql`: `DO $$` pre-check (RAISE EXCEPTION listing dup user_ids + profile ids) then UNIQUE constraints on students/teachers `user_id`; raise rolls back DDL.
- [x] 3.2 [STU-006/TEA-005] `tests/integration/migration-precheck.test.js`: (a) clean data -> constraints applied; (b) dup students/teachers -> abort pre-DDL, error lists user_id, no auto-repair; (c) second insert same user_id -> 23505.

Verify per slice: `pnpm test` (pretest migrates test DB, one txn per file).