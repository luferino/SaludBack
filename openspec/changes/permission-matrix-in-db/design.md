# Design: Permission Matrix in the Database

## Technical Approach

Move the role→permission matrix from the hardcoded `ROLE_PERMISSIONS` / `IMPLEMENTED_PERMISSIONS` constants into PostgreSQL (`permissions` catalog + `role_permissions` grants, seeded by migrations 006/007), expose it through a new async `PermissionMatrixReader` port, and make **the DB win per request**: `authenticate` recomputes `req.auth.permissions` on every protected request; `LoginUser` signs fresh claims from the same port; the code constants are swept entirely (no compat constant, no claim-backfill branch). `PermissionGuard` and `AuthenticatedRequest` are untouched. Matches proposal option **a1** and the user-auth / permission-guards delta specs.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Matrix authority | DB wins per request (option a1): `authenticate` calls `reader.permissionsForRole(role)` on every protected request | Claim wins (status quo); re-emit tokens; short-TTL | Grant changes effective on the next request, no re-login; one PK-prefix point-query on a tiny table, only on protected routes (see Data Flow) |
| a1 seam placement | Inside `authenticate`, after `verify`, before `req.auth` is set | In guards; in a wrapping middleware | Guards stay pure `includes` over `req.auth` (unchanged); every protected mount inherits the derivation automatically; `GET /me`, register and the three alta mounts all covered at wiring time |
| Sweep strategy | Full delete of `permissions.ts` (`ROLE_PERMISSIONS`, `IMPLEMENTED_PERMISSIONS`, `permissionsForRole`), no compat constant | Keep a claim-backfill branch / inert constant | Spec mandates no code constant defines the matrix; a leftover constant re-creates the stale-source window and the deploy+re-login cost the change exists to kill |
| Migration split | 006 = schema only (`CREATE TABLE`), 007 = seed only | One combined file | Future grant changes become seed-only files `008+` (each new, runner-applied once-only); versioning rule from proposal |
| cleanDb contract | `TRUNCATE role_permissions, permissions` then RE-EXECUTE the `007` file from disk (single source) | Duplicated seed constant in clean-db.js | Structurally eliminates migration↔mirror drift: the migration file IS the mirror; a rename that breaks the reference fails loudly in tests |
| Fail-closed status | Matrix-read failure → propagate the raw error → error handler responds **500** `INTERNAL_SERVER_ERROR` | 401 `UnauthorizedError` | See Fail-Closed Decision below |
| Fixture semantics | Deny proofs become matrix-backed: role-based deny where possible; mutation-based `setRolePermissions` with per-test restore for revocation proofs | Keep claim-fabricated tokens | Under DB-wins the token `permissions` claim is dead weight; fixtures must mutate `role_permissions` to steer `req.auth.permissions` |

## Data Flow

```
login:   POST /auth/login ─▶ LoginUser ─▶ matrixReader.permissionsForRole(role) ─▶ role_permissions
                                          └▶ sign(claims)  (permissions claim = ADVISORY)
request: Bearer token ─▶ authenticate ─ verify(token) ─▶ role ─▶ matrixReader.permissionsForRole(role)
                              │                                  └▶ role_permissions (PK-prefix point query)
                              ▼
                     req.auth = { role, permissions: [...DB], sub, userId }
                              ▼
              PermissionGuard(perm).authorize(req) ── pure includes(req.auth.permissions) ── unchanged
```

## SQL Design — Migrations 006 & 007

`migrate.ts` wraps each file in one transaction and records it in `schema_migrations` once-only — files MUST NOT contain `BEGIN/COMMIT`. Header comments follow the 005 house style: documented purpose, rollback, re-apply story.

**`006_create_permission_matrix.sql`** (schema only):

```sql
-- Schema migration: permission matrix moves into PostgreSQL as the single
-- source of truth (PG-001, user-auth deltas). `permissions` is the catalog
-- (permission + `enforced` flag); `role_permissions` holds the grants.
-- The matrix was previously pinned in src/modules/auth/domain/permissions.ts
-- (swept in the same change). A role's grants come from the PK-prefix point
-- query `SELECT permission FROM role_permissions WHERE role = $1`; the
-- PRIMARY KEY (role, permission) already indexes the leading column.
--
-- migrate.ts wraps this file in one transaction and records it once-only,
-- so a failure rolls both tables back.
--
-- Rollback: DROP TABLE role_permissions; DROP TABLE permissions;
-- (pure reference data — dropping loses no user data). Honest code-level
-- rollback must revert the sweep commit in the same unit (proposal
-- rollback plan: no partial rollback by design).
--
-- Re-apply: after a manual rollback the 006 row stays in schema_migrations;
-- `pnpm db:migrate` prints "Skipping 006 (already applied)" forever.
-- Re-applying requires deleting that row first:
--   DELETE FROM schema_migrations WHERE name = '006_create_permission_matrix.sql';

CREATE TABLE permissions (
  permission TEXT PRIMARY KEY,
  enforced BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL REFERENCES permissions(permission),
  PRIMARY KEY (role, permission)
);
```

**`007_seed_permission_matrix.sql`** (seed only) — derived from the CURRENT matrix in `permissions.ts` (verified: estudiante/teacher = `['profile:read','materias:read','turnos:read']`, admin = all 7; enforced = `IMPLEMENTED_PERMISSIONS`, 5; inert = the other 2):

```sql
-- Seed migration: canonical matrix, mirrored from the swept ROLE_PERMISSIONS
-- constant (verified against it before deletion). Catalog: 5 enforced
-- permissions + 2 inert claims (materias:read / turnos:read, enforced=false:
-- grantable and token-bearing, never guard-enforced — PG-001). Grants:
-- estudiante/teacher -> profile:read + the two inert claims; admin -> all 7
-- (admin keeps every protected mount, PG-003, without role-specific logic).
-- Future grant changes = new seed-only migrations 008+ (one file each).
--
-- Rollback: data-only — re-seed from an earlier 007, or DROP the tables (006).
-- Re-apply: DELETE FROM schema_migrations WHERE name = '007_seed_permission_matrix.sql';

INSERT INTO permissions (permission, enforced) VALUES
  ('users:write',    true),
  ('students:write', true),
  ('teachers:write', true),
  ('patients:write', true),
  ('profile:read',   true),
  ('materias:read',  false),
  ('turnos:read',    false);

INSERT INTO role_permissions (role, permission) VALUES
  ('estudiante', 'profile:read'),
  ('estudiante', 'materias:read'),
  ('estudiante', 'turnos:read'),
  ('teacher',    'profile:read'),
  ('teacher',    'materias:read'),
  ('teacher',    'turnos:read'),
  ('admin',      'users:write'),
  ('admin',      'students:write'),
  ('admin',      'teachers:write'),
  ('admin',      'patients:write'),
  ('admin',      'profile:read'),
  ('admin',      'materias:read'),
  ('admin',      'turnos:read');
```

## Port & Repository

`src/modules/auth/application/auth.ports.ts` — new async port (breaking for callers; both callers get patched in this change):

```ts
export interface PermissionMatrixReader {
  permissionsForRole(role: string): Promise<readonly string[]>;
}
```

`src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts` (new) — same pool-injection pattern as `PgUserRepository`:

```ts
export class PgPermissionMatrixRepository implements PermissionMatrixReader {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async permissionsForRole(role: string): Promise<readonly string[]> {
    const { rows } = await this.pool.query<{ permission: string }>(
      'SELECT permission FROM role_permissions WHERE role = $1 ORDER BY permission',
      [role],
    );
    return rows.map((row) => row.permission);
  }
}
```

Empty result (unknown role, or role with no grants) returns `[]` — **not** an error (spec: "Unknown role has no permissions" → guards answer 403). Only thrown errors are failures.

## Wiring & Middleware Changes

**`src/modules/auth/infrastructure/middleware/authenticate.ts`** — the middleware is ALREADY `async`, so no async-ness change; only signature + internals. The matrix read lives OUTSIDE the token-verify catch:

```ts
// signature: authenticate(tokenService: TokenServicePort, matrixReader: PermissionMatrixReader)
export function authenticate(tokenService: TokenServicePort, matrixReader: PermissionMatrixReader) {
  return async function authenticateMiddleware(req, _res, next): Promise<void> {
    const header = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) return next(new UnauthorizedError('Invalid or missing token'));

    let decoded: TokenClaims;
    try {
      decoded = await tokenService.verify(token);
    } catch {
      return next(new UnauthorizedError('Invalid or missing token')); // 401: token problem
    }

    const role = typeof decoded.role === 'string' ? decoded.role : '';
    let permissions: readonly string[];
    try {
      permissions = await matrixReader.permissionsForRole(role); // DB wins; claim ignored
    } catch (error) {
      return next(error as Error); // fail closed -> error handler -> 500
    }

    const authReq = req as AuthenticatedRequest;
    authReq.auth = { role, permissions: [...permissions] };
    if (typeof decoded.sub === 'string') {
      authReq.auth.sub = decoded.sub;
      authReq.auth.userId = decoded.sub;
    }
    return next();
  };
}
```

**`src/modules/auth/application/login-user.usecase.ts`** — port instead of constant: constructor gains `matrixReader: PermissionMatrixReader`; line 64 becomes `permissions: await this.matrixReader.permissionsForRole(user.role)`; a matrix failure propagates (fail closed → 500 at login too).

**`src/modules/auth/infrastructure/routes/auth.routes.ts`** — `AuthRouterDeps` gains `matrixReader: PermissionMatrixReader` (required, like the other ports); `new LoginUser({ repository, hasher, tokenService, matrixReader })`.

**`src/app.ts`** — one shared instance + injection into `LoginUser` and every `authenticate` mount:

```ts
const matrixReader = new PgPermissionMatrixRepository(pool);
// createAuthRouter({ ..., matrixReader })                    -> LoginUser
// registerMiddleware: authenticate(tokenService, matrixReader)
// meMiddleware:      authenticate(tokenService, matrixReader)
// '/patients'   : authenticate(tokenService, matrixReader)
// '/students'   : authenticate(tokenService, matrixReader)
// '/teachers'   : authenticate(tokenService, matrixReader)
```

**`authenticate` construction sites to update** (grep `authenticate(`): `src/app.ts` (×5), `tests/integration/auth.test.js` (`buildApp` ×2, `buildProtectedApp` ×1), `tests/unit/authenticate.test.js` (every test). The reader is a REQUIRED param, so TypeScript flags any missed site at compile time. `buildProtectedApp` gains a `matrixReader` param (defaults to a real `PgPermissionMatrixRepository(pool)` for the integration file).

## Fail-Closed Decision

**Matrix-read failure → 500 `INTERNAL_SERVER_ERROR`** (raw error propagated; the existing `error-handler.ts` maps unknown errors to 500 `{ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }`). Rationale:

- The user-auth scenario only requires "request is rejected; protected handler does not run" — no status pinned. The design must bind one.
- **401 would misclassify a server fault as a client-auth fault.** The token verified fine; the authority (DB) is unreachable. 401 triggers client re-login retry storms and pollutes auth-failure dashboards while hiding an availability problem.
- 500 is the honest signal ("server fault, retry"), zero new surface: no new error class, no error-handler change, the DB down at login already yields 500 the same way. A 503 would be semantically nicer but needs a new mapping — out of scope; note as accepted simplification.
- Guards never see the failure: `next(error)` short-circuits before `req.auth` is set (and before the handler runs) — the middleware contract "rejected, handler never runs" holds.

## cleanDb & Fixtures

**`tests/integration/helpers/clean-db.js`** — after the existing FK-safe deletes, restore the canonical matrix by executing the actual seed migration:

```js
await pool.query('TRUNCATE role_permissions, permissions'); // one statement: FK-safe, both tables
const seed = await readFile(new URL('../../../src/db/migrations/007_seed_permission_matrix.sql', import.meta.url), 'utf8');
await pool.query(seed);
```

Contract: grant/catalog migrations `008+` change the 007 file — cleanDb re-executes it, so the "mirror" cannot drift. (Fallback if the file-read feels heavy: a duplicated seed constant in clean-db.js + the documented contract from the proposal; the file-read is chosen because it makes drift structurally impossible.)

**`tests/integration/helpers/admin-token.js`** — rework:

- `setRolePermissions(pool, role, permissions)` — new matrix-mutating helper with **replace-all semantics** (`DELETE FROM role_permissions WHERE role = $1` then INSERT each; order-independent between tests).
- `seedAdmin` — derives the advisory claim from the DB: `SELECT permission FROM role_permissions WHERE role = 'admin'` after seeding the row (mirrors the save change: admin token truthfully carries every seeded grant).
- `seedUserWithPermissions(pool, { role, permissions })` — after seeding the user row calls `setRolePermissions(pool, role, permissions)`; the signed claim stays but is now advisory. Its callers (wiring discrimination tests) become matrix-backed for free.
- `tokenForRolePermissions` — **retired**: claim-driven semantics are dead under DB-wins; its deny proofs move to role-based or mutation-based forms (below).
- `tokenForRole` / `expiredTokenForRole` — unchanged shape (role + sub; claims ignored anyway) and keep serving deny-side 403/401 proofs.

**PG-003 fixture rework strategy** (`tests/integration/wiring.test.js`):

- Role-based deny (already in the file, lines 115–117 / 148–151 / 190–192 / 233–235): `tokenForRole('estudiante' | 'teacher')` on mounts whose permission the seeded role lacks → keeps passing **unchanged** (estudiante/teacher have no write grants in the seed: DB-derived `permissions` excludes `users:write`/`students:write`/`teachers:write`/`patients:write` → 403).
- The current `tokenForRolePermissions('admin', [...])` deny proofs (register/students/teachers/patients/me) flip to matrix mutation: `setRolePermissions(pool, 'admin', [...without the mapped permission])` → request → 403, then **restore admin's 7 grants in the test (try/finally)** so later admin-201 tests in the same file stay green; cleanDb's `after()` remains the suite-level safety net.
- The explicit revocation scenario (permission-guards: "Grant removed denies the next request") is the mutation-proof: token minted while granted, grant removed via `setRolePermissions`, same token → 403 on the next request.
- Allow-side discrimination tests (`seedUserWithPermissions` with exactly one write permission) → matrix-backed automatically; assert order-independence via replace-all helper.

## Unit Test Inversion Mapping

| File | Today | After |
|---|---|---|
| `tests/unit/authenticate.test.js` | construction `authenticate(tokenService)`; "explicit claim wins verbatim" (L95); "claim-less/malformed claim backfilled from ROLE_PERMISSIONS" (L78, L112) | construction `authenticate(tokenService, fakeReader)` (all tests); claim-wins test inverts to **"DB wins: reader result replaces the claim"** (claim advisory); backfill tests become "reader result used, claim ignored"; new test **"matrix read failure forwards the error (fail closed)"** asserting a non-`UnauthorizedError` error reaches `next`; role/`sub`/401 paths keep their assertions, construction-only edits |
| `tests/unit/login-user.test.js` | `LoginUser({repository, hasher, tokenService})`; sign asserts `ROLE_PERMISSIONS.estudiante` | constructor gains `matrixReader` fake (e.g. returns `['profile:read','materias:read','turnos:read']`); sign asserts the FAKE's return; new test "matrix read failure propagates (fail closed)" |
| `tests/unit/jwt-token-service.test.js` | `CLAIMS` fixture imports `ROLE_PERMISSIONS.estudiante` (L5, L14, L24) | fixture becomes a local literal — the service is matrix-agnostic; no behavior change |
| `tests/unit/permissions.test.js` | pins the constants (PG-001) | **DELETED** with `permissions.ts`; PG-001 coverage lands in the migration files (integration `pretest`), the repository unit test, and the PG-003 integration suite |
| `tests/unit/pg-permission-matrix.repository.test.js` (new) | — | fake pool (house pattern from `pg-user-repository.test.js`): asserts `WHERE role = $1` SQL, row mapping, no rows → `[]` |
| `tests/integration/auth.test.js` | `buildApp`/`buildProtectedApp` call `authenticate(tokenService)`; L309 asserts `ROLE_PERMISSIONS.teacher`; `/secure` echo expects claim `['profile:read']` | wire real `PgPermissionMatrixRepository(pool)`; L309 compares against the seeded teacher grants (`SELECT ... role_permissions WHERE role='teacher'` or the 3-literal); `/secure` echo expects the DB-derived set (`profile:read` + 2 inert) |

## Testing Strategy

| Layer | Spec | What | Approach |
|---|---|---|---|
| Unit | user-auth | authenticate DB-wins / claim advisory / fail-closed 500 / sub & 401 paths | `authenticate.test.js` rework + fake reader |
| Unit | user-auth | LoginUser signs matrix-derived claims; failure propagates | `login-user.test.js` rework |
| Unit | PG-001 | repository point query + mapping + empty role → `[]` | new `pg-permission-matrix.repository.test.js` |
| Integration | PG-001 | migrations apply to fresh DB (pretest); catalog 7 rows (5 enforced + 2 inert); grants 13 rows | `migration-precheck`-style assertions — covered by pretest + seed-admin flow; add explicit seed assertions |
| Integration | PG-002/PG-003 | five mounts 401/403/201/200 unchanged via matrix fixtures | `wiring.test.js` rework (above) |
| Integration | user-auth | revoke-on-next-request, grant-on-next-request, unknown-role 403, failed matrix → 500 | mutation proofs in `wiring.test.js` |
| Integration | user-auth | fresh login reflects matrix changes | `auth.test.js` login claims vs seeded grants |

Suite runs under the existing `pnpm test` (`--test-concurrency=1`, `pretest` applies migrations 006/007).

## Chained PR Slice Plan

Chain strategy (split confirmation, micro-boundaries) is a **decision point for tasks/apply** — not decided here (preflight: chain not yet chosen, confirmed 3 slices).

**Slice ① — core: migrations + port + repo + sweep + wiring + unit tests** (12–14 files, est. ~400–470 changed lines)
`006_create_permission_matrix.sql` (+create), `007_seed_permission_matrix.sql` (+create), `auth.ports.ts` (+port), `pg-permission-matrix.repository.ts` (+create), `permissions.ts` (−delete), `authenticate.ts`, `login-user.usecase.ts`, `auth.routes.ts`, `app.ts`, `authenticate.test.js`, `login-user.test.js`, `pg-permission-matrix.repository.test.js` (+create). Green: `pnpm test` unit subset + `db:migrate` on a fresh DB (006/007 apply). Independently commitable: everything compiles, no integration suite depends on the new code yet (integration suites still pass: they build their own `authenticate` and are unaffected).

**Slice ② — integration: fixtures + cleanDb + suites** (7 files, est. ~350–420 changed lines)
`helpers/clean-db.js`, `helpers/admin-token.js`, `auth.test.js`, `wiring.test.js`, `students.test.js`, `teachers.test.js`, `patients.test.js`. Green: full `pnpm test` (integration suites now exercise DB-wins end-to-end).

**Slice ③ — spec-level cleanups + leftover units** (est. ~60–120 changed lines, docs/tests only, no runtime code)
`openspec/specs/profile-read/spec.md` (Purpose fix: "granted to every role by `ROLE_PERMISSIONS`" → seeded `role_permissions` grants), plus whichever of `jwt-token-service.test.js` / `permissions.test.js` were deferred from ①, and the baseline-spec sync for the six delta specs (`user-auth`, `permission-guards`, `user-registration`, `student-registration`, `teacher-registration`, `patient-registration`) — either direct baseline edits here or via the archive phase (tasks decision).

## Migration / Rollout

No feature flag. `pretest` applies 006/007 to the test DB; prod via `pnpm db:migrate` (once-only per file, transactional). Rollback: see 006 header — dropping the tables is data-loss-free, but the code sweep removes the fallback, so the honest rollback is reverting the change as a unit (proposal rollback plan). Runtime-editable matrix and caches are out of scope.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Asynchronous-authenticate fallout in test constructions (app.ts ×5, auth.test.js ×3, authenticate.test.js ×8) | Med | Reader is a REQUIRED constructor param → TS flags every missed site; grep `authenticate(` call sites; unit fakes; `buildProtectedApp` gains explicit reader param |
| Suite drift / cross-test poisoning from matrix mutations under the shared DB | Med | `setRolePermissions` replace-all semantics (order-independent); role-based deny preferred over admin-grant mutation; admin mutations restored in-test (try/finally); cleanDb reseeds canonical matrix per file; serial runner `--test-concurrency=1` |
| Migration ↔ cleanDb drift on future grant migrations (008+) | Low | cleanDb RE-EXECUTES the 007 file (single source; structural no-drift); documented contract that grant changes edit 007 in the same change; rename-coupling is accepted (visible test failure) |
| Spec baseline drift (profile-read Purpose still cites `ROLE_PERMISSIONS`) | Low | Folded into slice ③ as a direct baseline edit; archive phase syncs the six delta baselines |

## Open Questions

- profile-read has NO delta spec in this change — its Purpose must be fixed as a direct baseline edit. Slice ③ already carries it; only the mechanism (direct edit vs archive-time) needs pinning, deferred to tasks/apply.