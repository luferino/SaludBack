# Proposal: Permission Matrix in the Database

## Intent

The role→permission matrix is hardcoded in `src/modules/auth/domain/permissions.ts` (`ROLE_PERMISSIONS`, `IMPLEMENTED_PERMISSIONS`). Every permission change — a new grant, a revoked permission, a new role — requires a code change, a deploy, and a token re-login to take effect; tokens minted before the change carry stale claims. This change moves the matrix to PostgreSQL as the single source of truth (versioned by migrations), makes the DB win per request, and sweeps the constants from code entirely.

## Solution Summary

- Two tables, seeded by migrations: `permissions` (catalog, `enforced` flag) + `role_permissions` (grants, PK `(role, permission)`). Matrix authority = DB.
- **DB wins per request (option a1)**: `authenticate` derives `req.auth.permissions` from the DB matrix on every protected request (one PK-prefix point query), so a grant change takes effect on the next request with no re-login. Token `permissions` claim becomes **advisory** — ignored by `authenticate`.
- `LoginUser` reads the same port at sign time so fresh tokens carry truthful claims; `PermissionGuard` stays a pure in-memory `includes` check — **no guard changes**.
- Full sweep: `ROLE_PERMISSIONS` / `IMPLEMENTED_PERMISSIONS` / `permissionsForRole` deleted, no compat constant, no claim-backfill branch.

## Decided Tradeoffs (JWT strategy)

| Option | Verdict | Why |
|---|---|---|
| **a1 — DB wins per request** | ✅ chosen | Immediate revocation (next request), one indexed point-query on a tiny table, only on protected routes; tokens stay 2h; no client re-login |
| Re-emit tokens on change | ❌ | Needs token-revocation/refresh infra; revoked clients keep working until re-login |
| Short-TTL tokens | ❌ | Forces frequent re-login for all users; doesn't fix stale claims within TTL |
| Claim wins (status quo) | ❌ | Deploy + re-login per change; stale-token window |

## Scope

### In Scope
- Migrations `006_create_permission_matrix.sql` + `007_seed_permission_matrix.sql` (**two files — decision**: schema and seed separated so future grant changes become seed-only migrations `008+`, each a new file, per the decided versioning rule; runner is transactional once-only per file).
- `PermissionMatrixReader` port + `PgPermissionMatrixRepository` point-query impl.
- `authenticate(tokenService, reader)` — DB-derived `req.auth.permissions`; `LoginUser` matrix read; wiring in `app.ts`; `auth.routes.ts` injection.
- Sweep of `permissions.ts` (no compat constant); claim-fabricated test fixtures reworked to matrix-backed fixtures; `cleanDb` matrix handling.
- Seed data: catalog 7 perms (5 enforced: `users:write`, `students:write`, `teachers:write`, `patients:write`, `profile:read`; 2 inert `enforced=false`: `materias:read`, `turnos:read`); grants: estudiante/teacher → `profile:read` + inert, admin → all 7.

### Out of Scope
- Patient read/update change B (separate change).
- Runtime-editable matrix without migration (tool/UI/admin surface).
- Refresh-token infrastructure, token blacklist.
- Multi-instance matrix cache.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `user-auth`: Token Claims Contract + Token Verification — `permissions` claim becomes advisory; `req.auth.permissions` sourced from DB matrix (delta spec needed).
- `permission-guards`: PG-001 — matrix defined by `permissions` + `role_permissions` tables seeded via migrations; all `ROLE_PERMISSIONS` references removed (delta spec needed; PG-002/PG-003 outcomes unchanged).

## Design Sketch

```sql
-- 006_create_permission_matrix.sql
CREATE TABLE permissions (
  permission TEXT PRIMARY KEY,
  enforced BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL REFERENCES permissions(permission),
  PRIMARY KEY (role, permission)
);
-- 007_seed_permission_matrix.sql
-- catalog: 5 enforced + 2 inert; grants: estudiante/teacher = profile:read+materias:read+turnos:read,
-- admin = all 7. PK (role, permission) already indexes the role point-query.
```

- Port: `PermissionMatrixReader { permissionsForRole(role): Promise<readonly string[]> }` in `auth.ports.ts` (async — breaking change for callers).
- Repo: `SELECT permission FROM role_permissions WHERE role = $1` — `pg-permission-matrix.repository.ts`.
- `authenticate`: after `verify`, `authReq.auth = { role, permissions: await reader.permissionsForRole(role) }` — claim ignored, backfill branch removed.
- `LoginUser`: `permissions: await reader.permissionsForRole(user.role)` at sign.
- `app.ts`: `const matrix = new PgPermissionMatrixRepository(pool)`; passed to all `authenticate` mounts + `createAuthRouter` (→ LoginUser).

## Impact

| Area | Impact | Files |
|---|---|---|
| Migrations | New | `src/db/migrations/006_create_permission_matrix.sql`, `007_seed_permission_matrix.sql` |
| Domain | Removed | `src/modules/auth/domain/permissions.ts` ($-$) |
| Application | Modified | `auth.ports.ts` (+port), `login-user.usecase.ts` (±) |
| Infrastructure | New/Modified | `pg-permission-matrix.repository.ts` (new), `authenticate.ts` (±), `auth.routes.ts` (±) |
| App wiring | Modified | `src/app.ts` (±) |
| Tests (unit) | Removed/Modified | `permissions.test.js` (removed); `authenticate.test.js`, `login-user.test.js`, `jwt-token-service.test.js` (rework) |
| Tests (integration) | Modified | `helpers/admin-token.js`, `helpers/clean-db.js`, `auth.test.js`, `wiring.test.js` (PG-003), `students/teachers/patients` allow-side proofs |
| Specs | Modified | `user-auth`, `permission-guards` delta specs (specs phase) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Per-request DB read cost on protected routes | Low | Tiny table, PK point query; options a1 decision accepted; no cache in scope — revisit only with measured need |
| Test drift from matrix mutations (suites poison each other under shared DB) | Med | **cleanDb decision**: truncate `role_permissions` + `permissions` and re-seed mirroring 007 (documented contract: grant migrations must update the mirror in the same change); serial runner `--test-concurrency=1` |
| Spec drift: `user-auth`/`permission-guards` still pin `ROLE_PERMISSIONS` and claim-wins semantics | Med | Flagged here; delta specs produced in specs phase and archived with the change |
| Diff exceeds 400-line review budget | High | Chained PRs (see below) |

## Rollback Plan

Migrations are pure reference data — dropping is data-loss-free: `DROP TABLE role_permissions; DROP TABLE permissions;`. But the code sweep removes the only fallback: a **code-only** rollback leaves no matrix source when the tables are gone (500s on every protected route), and a **migration-only** rollback leaves dead reference tables. Honest rollback = atomic revert of BOTH the migration files and the sweep commit together (git revert of the change as a unit, verified by the integration suite). The single-source-of-truth sweep deliberately forfeits short-term partial rollback.

## Dependencies

- None external. Prereq: current auth/permission-guards features green (PG-003 wiring suite is the fixture-rework anchor).

## Review / Budget Note

Estimated ~750–950 changed lines (tests dominate: fixture rework + PG-003 suite + three alta suites). This exceeds the 400-line review budget → `Decision needed before apply: Yes`, `Chained PRs recommended: Yes` (e.g. ① migrations+port+repo+wiring, ② guard/auth integration suites + cleanDb, ③ unit-test rework + spec deltas). Delivery strategy is ask-always: confirm chain slicing before apply.

## Success Criteria

- [ ] Mutating `role_permissions` changes the very next request's outcome (no re-login) — revocation is immediate
- [ ] Fresh login tokens carry matrix-derived claims; `permissions.ts` fully gone (no references in `src/` or `tests/`)
- [ ] Migrations 006+007 apply cleanly to a fresh DB; re-run is a no-op (once-only)
- [ ] PG-002/PG-003 401/403/admin outcomes unchanged, proven via matrix-backed fixtures
- [ ] Full suite green under `--test-concurrency=1`; cleanDb leaves canonical matrix state