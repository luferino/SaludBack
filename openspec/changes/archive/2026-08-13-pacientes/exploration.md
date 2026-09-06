# Exploration: pacientes module — personal data entry (alta de datos personales)

## Current State

SaludBack is a Node.js 24 / Express 5 / PostgreSQL backend with modular Clean
Architecture: `src/modules/<module>/{domain,application,infrastructure}`. Only
the `auth` module is implemented; `shared` holds cross-cutting code; `pacientes`
exists only as an empty scaffold directory (untracked — git does not track empty
dirs). Grep for `paciente|patient` across js/json/md/sql/env finds zero code
references. The openspec/config.yaml mentions the empty dir but is stale
(scaffold-era: "no test runner", "src/config.js empty" — both now false).

### Reference pattern: the auth module (template for any new module)

- `domain/` — entity (`user.js`, plain class, `static create`, `toJSON()` that
  hides secrets) and role/permissions model (`permissions.js`:
  `ROLE_PERMISSIONS` role→permissions map, naming `<resource>:<action>`; only
  role today is `estudiante` with `profile:read`, `materias:read`,
  `turnos:read`).
- `application/` — use cases (`register-user.js`, `login-user.js`): validate →
  throw `BadRequestError` on missing fields → call ports → return entity/result;
  domain errors imported from `shared/domain/errors.js`. Ports (`ports.js`) are
  abstract classes with throwing stubs (`UserRepositoryPort`,
  `PasswordHasherPort`, `TokenServicePort`), constructor-injected.
- `infrastructure/` — routes factory (`createAuthRouter({ repository, hasher,
  tokenService, guard = new OpenGuard() })`) where each handler calls
  `guard.authorize(req)` before the use case; pg repository
  (`PgUserRepository extends UserRepositoryPort`, snake_case→camelCase
  `rowToUser` mapper, `USER_COLUMNS` constant); services (`BcryptHasher`,
  `JwtTokenService`); middleware (`authenticate(tokenService)` → verifies Bearer
  token → `req.auth = { role, permissions }`, invalid → `UnauthorizedError`).
- Wiring in `src/index.js`: one `pg.Pool` from `config.databaseUrl`, instantiate
  dependencies, `app.use(express.json())`, mount `app.use('/auth',
  createAuthRouter({...}))`, `errorHandler` last. `app.listen` at the end.
- Error handling: `shared/domain/errors.js` — `AppError(statusCode, code)` base
  + `BadRequestError`(400/BAD_REQUEST), `ConflictError`(409/CONFLICT),
  `UnauthorizedError`(401/UNAUTHORIZED). `middleware/error-handler.js` maps
  AppError → `{error:{code,message}}`, honors exposed middleware statuses
  (e.g. body-parser 400), everything else → 500.
- Guard seam: `shared/application/guard.js` — `Guard` base (authorize throws) +
  `OpenGuard` (allow-all). Auth register runs behind `OpenGuard` today; login
  bypasses the guard. **There is no permission-checking guard yet.**

### DB layer

`src/db/migrate.js` is a small custom runner (no ORM, no migration library):
creates `schema_migrations(name PK, applied_at)`, reads sorted `*.sql` files
from `src/db/migrations/`, applies each inside a transaction and records the
filename; idempotent (skips applied). Dev: `pnpm db:migrate` (`.env`); tests:
`pretest` hook runs the same runner with `.env.test`, so new migrations are
auto-applied to `saludback_test` before `pnpm test`.

Existing table `001_create_users.sql`: `users(id UUID PK DEFAULT
gen_random_uuid(), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
role TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Conventions:
snake_case columns, UUID PKs via `gen_random_uuid()`, `TIMESTAMPTZ` timestamps.
A patients table would be `002_create_patients.sql` with the same conventions.

### Config

`src/config.js`: fail-fast on `REQUIRED_ENV = ['DATABASE_URL','JWT_SECRET']`;
falls back to `process.loadEnvFile()` only when not started with `--env-file`;
exports a frozen object: `port` (3000), `databaseUrl`, `jwtSecret`,
`jwtExpiresIn` ('2h'), `bcryptCost` (12). No new env vars needed for pacientes.

### Tests

- Unit: `tests/unit/*.test.js` — `node:test` + `assert/strict`, fakes injected
  (`FakeHasher`, fake pool `{ query }`); assert success paths, error classes
  (`assert.rejects(..., BadRequestError)`), and that the DB was never called.
- Integration: `tests/integration/auth.test.js` — real `pg.Pool` against
  `config.databaseUrl` (`.env.test` → `saludback_test`), builds a fresh express
  app with the real router + `errorHandler`, listens on ephemeral port
  (`listen(0)`), drives it with `fetch`; `before` cleans tables, `after` closes
  server + pool. `pnpm test` = `node --env-file=.env.test --test`; currently
  49 tests green (unit + integration).

## Affected Areas

- `src/modules/pacientes/` — new module: `domain/patient.js`, `domain/ports.js`
  (or `application/ports.js` per auth convention), `application/create-patient.js`,
  `infrastructure/routes/patient.routes.js`, `infrastructure/repositories/pg-patient-repository.js`.
- `src/db/migrations/002_create_patients.sql` — new additive migration.
- `src/index.js` — instantiate `PgPatientRepository(pool)` and mount
  `app.use('/patients', createPatientRouter({...}))`.
- `src/modules/shared/application/guard.js` — likely gains a permission-checking
  guard (decision point), since `authenticate` is not currently wired to any
  route and only `OpenGuard` exists.
- `src/modules/auth/domain/permissions.js` — add `pacientes:<action>` permissions
  (and/or a new role) to `ROLE_PERMISSIONS`.
- `tests/unit/` + `tests/integration/patients.test.js` — new suites mirroring auth.
- `openspec/config.yaml` — stale context block (says bare scaffold); refresh.

## Approaches

1. **Mirror the auth module exactly** — `modules/pacientes/{domain,application,infrastructure}`
   + `002_create_patients.sql` + wiring in `src/index.js` + unit/integration tests
   with the identical shape (entity, use case with validation, pg repository,
   routes factory, error classes).
   - Pros: proven template; zero new infrastructure; tests already know the pattern.
   - Cons: none material; must still decide the guard policy.
   - Effort: Low-Medium.

2. **Mirror auth + add a permission guard** — as (1), plus a
   `PermissionGuard` (extends `Guard`, verifies token via injected
   `TokenService`/`authenticate` and checks `req.auth.permissions` for e.g.
   `pacientes:write`) and `pacientes` permissions in `ROLE_PERMISSIONS`. Patient
   routes mount the guard at the seam; `authenticate` gets its first real wiring.
   - Pros: satisfies the "patient module is expected to be protected" intent;
     establishes the guard pattern all future modules reuse; no self-registration.
   - Cons: touches the shared module and auth permissions map; guard policy (who
     performs alta — admin/medico?) is a business decision for propose/spec.
   - Effort: Medium.

3. **Use-case-only slice (domain + application + repository, no HTTP routes)** —
   prove persistence and validation first, expose HTTP later.
   - Pros: smallest possible slice.
   - Cons: "alta de datos personales" is an API feature; integration tests are
     the repo's convention for proving the whole flow; deviates from the pattern.
   - Effort: Low, but incomplete.

## Recommendation

Approach 2 as the end state, with the first slice (this change) scoped to
personal-data entry only. Follow auth's structure file-for-file; the only new
pieces are the migration and — pending the business decision — a
permission-checking guard plus `pacientes` permissions. The guard question
("who can register a patient?") is the single decision point that must be
resolved in propose/spec before design; if the answer is "admin-originated like
user alta", the `OpenGuard`-with-seam precedent from auth can carry this slice
and the guard can land later without rework (the seam is already the pattern).

## Risks

- **Authorization policy undefined**: `authenticate` middleware exists but is
  wired to no route; no `PermissionGuard` exists. The change must state whether
  patient alta is protected now (and by whom) or rides the open seam.
- **Sensitive health data**: field model (document type/number, birth date,
  contact info) and validation rules need business input; a unique document
  number implies a 409 conflict path.
- **Custom migration runner is forward-only**: no rollback; `002` must be purely
  additive (safe). Destructive deltas unsupported.
- **Dev DB availability**: PostgreSQL local credentials were a past blocker
  (resolved with password in `.env.test`, DB `saludback`/`saludback_test`).
- **Review budget**: auth shipped ~1100 lines across 3 chained PRs; a patients
  slice (entity+repo+use case+routes+guard+migration+tests) plausibly lands in
  400-700 lines → tasks phase must forecast PR splitting (single vs chained).
- **Stale openspec/config.yaml**: refresh context during propose/init to avoid
  downstream phases trusting outdated facts.

## Ready for Proposal

Yes. The module pattern is fully established by `auth`; the two business inputs
the orchestrator should get from the user before/at proposal are: (1) who
performs the alta de datos personales (role + guard policy), and (2) the exact
personal-data fields and their validation/uniqueness rules.
