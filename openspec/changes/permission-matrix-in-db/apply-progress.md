# Apply Progress — PG-001 DB Wins (Slice 1: Core wiring + DB-Wins unit rework)

**Change**: `permission-matrix-in-db`
**Phase**: sdd-apply — Slice 1 (PR 1) — DB-wins core
**Date**: 2026-09-21
**Mode**: Standard (tdd: false per openspec/config.yaml; strict-tdd NOT loaded)
**Status**: SLICE-1 COMPLETE — all 16 tasks done; unit green (24/24), integration auth 26/27 (1 expected Slice 2 behavioral change)

---

## Slice 1 — Core: DB wins over token claims + injection matrix reader

### Completed Tasks (persisted `[x]` in tasks.md — node-verified)

#### Batch 1 (previous sessions — migrations, port, repo, wiring)
- [x] 1.1 [PG-001] `src/db/migrations/006_create_permission_matrix.sql` — permissions catalog + role_permissions grants
- [x] 1.2 [PG-001, Token Claims Contract] `src/db/migrations/007_seed_permission_matrix.sql` — seed 7 catalog rows + 13 grants
- [x] 1.3 [PG-001] Verify: `pnpm db:migrate` applies 006/007 on a fresh DB; re-run is a no-op
- [x] 1.4 [Token Claims Contract, Token Verification] `src/modules/auth/application/auth.ports.ts` — PermissionMatrixReader port
- [x] 1.5 [PG-001, Token Verification] `src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts` — pool-injected point query
- [x] 1.6 [PG-001] `tests/unit/pg-permission-matrix.repository.test.js` — fake-pool house pattern, 4/4 green

#### Batch 2 (previous session — DB-wins middleware + use-case rework)
- [x] 1.7 [Token Verification] `src/modules/auth/infrastructure/middleware/authenticate.ts` — `authenticate(tokenService, matrixReader)`; DB wins
- [x] 1.8 [Token Verification] `tests/unit/authenticate.test.js` — DB-wins rework, 4/4 green
- [x] 1.9 [Token Claims Contract] `src/modules/auth/application/login-user.usecase.ts` — matrixReader injected, DB wins sign
- [x] 1.10 [Token Claims Contract] `tests/unit/login-user.test.js` — matrixReader fake, 4/4 green
- [x] 1.11 [Token Claims Contract] `src/modules/auth/infrastructure/routes/auth.routes.ts` — AuthRouterDeps + LoginUser matrixReader
- [x] 1.12 [Token Verification, PG-003] `src/app.ts` — one PgPermissionMatrixRepository instance, 5 authenticate mounts

#### Batch 3 (this session — consumer sweep, delete permissions.ts, JWT test fix)
- [x] 1.13 [Token Verification, PG-003] Compat sweep: `tests/integration/auth.test.js` 3 construction sites + `admin-token.js` seedAdmin
- [x] 1.14 [PG-001] Sweep: deleted `src/modules/auth/domain/permissions.ts` + `tests/unit/permissions.test.js`
- [x] 1.15 [Token Claims Contract] `tests/unit/jwt-token-service.test.js` — CLAIMS fixture → local literal
- [ ] 1.16 Verify slice ①: full `pnpm test` green (serial)

### Verification Evidence

#### Unit tests — 24/24 green
`node --import tsx --env-file=.env.test --test --test-concurrency=1 tests/unit/authenticate.test.js tests/unit/login-user.test.js tests/unit/pg-permission-matrix.repository.test.js tests/unit/jwt-token-service.test.js`
- authenticate.test.js (4/4): DB wins, fail-closed, sub/role paths
- login-user.test.js (4/4): matrix injected, DB wins sign, failure propagated
- pg-permission-matrix.repository.test.js (4/4): SQL, mapping, empty→[], pool failure
- jwt-token-service.test.js (12/12): sign, verify, kid rotation (no ROLE_PERMISSIONS dependency)

#### Integration auth.test.js — 26/27 green
`node --import tsx --env-file=.env.test --test --test-concurrency=1 tests/integration/auth.test.js`
- 26 pass, 1 expected behavioral failure (Slice 2):
  - `GET /auth/me rejects a verified token without profile:read with 403` → returns 401 (user not found)
  - Root cause: token has `role: 'admin'`, DB gives admin `profile:read`; user ID doesn't exist → 401 before guard. Needs matrix-mutation fixture (Slice 2 task 2.6).

#### Integration suites — 32 failures (all Slice 2 scope)
- students.test.js, teachers.test.js, patients.test.js: `authenticate(tokenService)` without matrixReader → TypeError (Slice 2 task 2.7/2.8/2.9)
- wiring.test.js: `tokenForRolePermissions` uses claim-based deny, but DB wins → 201 instead of 403 (Slice 2 task 2.6)
- create-admin-bootstrap.test.js: same matrixReader missing (Slice 2 task 2.1/2.2)

### Files Changed (Slice 1 cumulative — 8 files modified, 2 created, 2 deleted)

| File | Action | What Was Done |
|---|---|---|
| `src/db/migrations/006_create_permission_matrix.sql` | Created | permissions catalog + role_permissions schema |
| `src/db/migrations/007_seed_permission_matrix.sql` | Created | 7 catalog rows + 13 grants seed |
| `src/modules/auth/application/auth.ports.ts` | Modified | Added PermissionMatrixReader async port |
| `src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts` | Created | Pool-injected point query, 4/4 green |
| `src/modules/auth/infrastructure/middleware/authenticate.ts` | Modified | matrixReader param, DB wins per request |
| `src/modules/auth/application/login-user.usecase.ts` | Modified | matrixReader injected, DB wins sign |
| `src/modules/auth/infrastructure/routes/auth.routes.ts` | Modified | AuthRouterDeps + LoginUser matrixReader |
| `src/app.ts` | Modified | One matrixReader instance, 5 authenticate mounts |
| `src/modules/auth/domain/permissions.ts` | Deleted | ROLE_PERMISSIONS, IMPLEMENTED_PERMISSIONS, permissionsForRole swept |
| `tests/unit/permissions.test.js` | Deleted | PG-001 coverage moved to migration/repo/wiring suites |
| `tests/unit/authenticate.test.js` | Reworked | DB-wins, plain-JS, 4/4 green |
| `tests/unit/login-user.test.js` | Reworked | DB-wins, plain-JS, 4/4 green |
| `tests/unit/jwt-token-service.test.js` | Modified | CLAIMS → local literal, no ROLE_PERMISSIONS dependency |
| `tests/integration/auth.test.js` | Modified | 3 construction sites + matrixReader, ROLE_PERMISSIONS → literals |
| `tests/integration/helpers/admin-token.js` | Modified | seedAdmin derives perms from DB via PgPermissionMatrixRepository |

### Deviations

- **auth.test.js `GET /auth/me rejects...403`**: This test cannot pass under DB-wins without a matrix-mutation fixture. The token has `role: 'admin'` → DB grants `profile:read` → guard passes → user not found → 401. This is expected and belongs to Slice 2.
- **Test file constraint**: All unit test files remain plain-JS (node's ESM parser rejects TS syntax in `.js` files).

### Remaining Tasks (Slice 2 — PR 2)

- [ ] 2.1 clean-db.js: TRUNCATE + re-execute 007
- [ ] 2.2 admin-token.js: add setRolePermissions
- [ ] 2.3 admin-token.js: seedAdmin derives from DB query
- [ ] 2.4 admin-token.js: retire tokenForRolePermissions
- [ ] 2.5 auth.test.js: fixture rework for DB-wins assertions
- [ ] 2.6 wiring.test.js: matrix-mutation deny proofs
- [ ] 2.7 students.test.js: matrix-backed rework
- [ ] 2.8 teachers.test.js: matrix-backed rework
- [ ] 2.9 patients.test.js: matrix-backed rework
- [ ] 2.10 Verify slice ②
