# Apply Progress — pacientes change (ALL PHASES COMPLETE)

**Change**: pacientes | **Mode**: Standard (strict_tdd: false) | **Batches**: PR 1 (foundation) + PR 2 (use case) + PR 3 (routes/wiring/integration) + Phase 4 (cleanup/verification)

## Completed Tasks (cumulative across all batches)

### Phase 1 — PR 1 (foundation)
- [x] 1.1 `src/db/migrations/002_create_patients.sql` — patients DDL (UUID PK gen_random_uuid, documento TEXT NOT NULL UNIQUE, nombres, apellidos, fecha_nacimiento DATE NOT NULL, email, celular, sexo, direccion NOT NULL, created_by UUID NULL REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now()). Applied on dev + test DB, re-run skips.
- [x] 1.2 `src/modules/pacientes/domain/patient.js` — Patient entity, static create, toJSON() whitelist with exactly 11 PAT-006 keys; `created_by` present as `null`, never omitted.
- [x] 1.3 `src/modules/pacientes/application/ports.js` — PatientRepositoryPort (findByDocumento, create), mirroring auth ports.
- [x] 1.4 `src/modules/pacientes/infrastructure/repositories/pg-patient-repository.js` — PATIENT_COLUMNS, findByDocumento (WHERE documento = $1), create RETURNING, rowToPatient normalizes fecha_nacimiento → YYYY-MM-DD.
- [x] 1.5 `tests/unit/pg-patient-repository.test.js` — fake pool: SQL text + params, null vs row mapping, date normalization, toJSON exactly 11 keys.
- [x] 1.6 `pnpm db:migrate` + `pnpm test` green — 53/53.

### Phase 2 — PR 2 (use case)
- [x] 2.1 `src/modules/pacientes/application/create-patient.js` — CreatePatient: 8 required fields (missing/null/blank → 400); documento trimmed `/^\d{4,8}$/` (`12A4`, `123`, `123456789` → 400); sexo M|F (`m` → 400); strict YYYY-MM-DD valid not future (`2026-02-31` → 400); email local@domain; dup findByDocumento → ConflictError 409; else create({...fields, createdBy}).
- [x] 2.2 `tests/unit/create-patient.test.js` — FakePatientRepository; asserts create never called on 400/409 paths; all PAT-003 variants.
- [x] 2.3 `pnpm test` green — 63/63.

### Phase 3 — PR 3 (routes / wiring / integration)
- [x] 3.1 `src/modules/pacientes/infrastructure/routes/patient.routes.js` — `createPatientRouter({ repository, guard = new OpenGuard(), getActor = defaultGetActor })`; handler: `guard.authorize(req)` → `getActor(req)` → CreatePatient.execute({ ...req.body, createdBy: actor }) → 201 `patient.toJSON()`; `defaultGetActor(req) = req.auth?.sub ?? null` (PAT-004/005 seams).
- [x] 3.2 `src/index.js` — `new PgPatientRepository(pool)`; `app.use('/patients', createPatientRouter({ repository }))` — no guard/getActor passed (open route, null actor).
- [x] 3.3 `tests/integration/patients.test.js` — 6 tests mirroring the auth harness: 201 + exact 11-key body + created_by null; duplicate → 409 count stays 1; 400 loop (no row persisted); attached throwing guard → 401 no row; stub middleware setting req.auth.sub → created_by populated (real users row inserted first for the FK); garbage Bearer on open route → 201 + created_by null.
- [x] 3.4 Full `pnpm test` green — 69/69. Curl smoke on dev server: POST /patients → 201 exact 11-key body + created_by null; duplicate → 409. Smoke row cleaned from dev DB.

### Phase 4 — Cleanup / Verification (THIS BATCH, DONE)
- [x] 4.1 Contract audit — PASS. Evidence:
  - Integration (tests/integration/patients.test.js): CONTRACT_KEYS array of exactly 11 keys (lines 14-26); test `POST /patients creates a patient with the exact 11-key contract body` (line 85) asserts `assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort())` (line 89 — exact set equality: 11 keys, no extras) and `assert.equal(body.created_by, null)` (line 93, anonymous); test `a garbage Bearer token on the open route still creates with created_by null` (line 209) asserts 201 + created_by null (line 215-216, PAT-006/004 invalid-token).
  - Unit (tests/unit/pg-patient-repository.test.js:98-128): `toJSON returns exactly the 11 PAT-006 contract keys with a normalized date` — asserts the exact 11-key sorted list (lines 114-126) and `created_by` null (line 127).
  - Implementation: route responds only `res.status(201).json(patient.toJSON())` (patient.routes.js:24); toJSON is an explicit whitelist object literal with exactly 11 keys and `created_by: this.createdBy ?? null` (patient.js:63-77); defaultGetActor = `req.auth?.sub ?? null` (patient.routes.js:39-40), open route sets no req.auth → null.
  - All 6 integration tests pass on the run (6 pass / 0 fail); full suite 69/69.
- [x] 4.2 Fresh-schema sanity — PASS. Executed on the DEDICATED test DB `saludback_test` (postgres://localhost:5432/saludback_test from .env.test); dev DB `saludback` untouched.
  - Dropped and recreated only the `public` schema on `saludback_test` (DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public) via an inline pg script guarded to refuse any target other than `saludback_test`. This dropped users, patients, schema_migrations (fresh slate).
  - `node --env-file=.env.test src/db/migrate.js` (NOT `pnpm db:migrate`, which targets the dev DB) → "Applying 001_create_users.sql... Applying 002_create_patients.sql... Applied 2 new file(s)." → 002 applied exactly once on the fresh schema.
  - Re-run same command → "Skipping 001... Skipping 002... Applied 0 new file(s)." → re-runs skip (runner is forward-only, per-file transaction, recorded in schema_migrations).
  - Post-state verified: schema_migrations = [001_create_users.sql, 002_create_patients.sql]; patients columns = id, documento, nombres, apellidos, fecha_nacimiento, email, celular, sexo, direccion, created_by, created_at; public tables = patients, schema_migrations, users.
  - `pnpm test` (pretest auto-migrates test DB, skips) → 69 tests, 69 pass, 0 fail, 0 skipped.
- [x] 4.3 Zero-delta confirmation — PASS. Evidence:
  - The pacientes change spans commits `4f3f37d..19c9907` (first pacientes commit cee3ba1, parent 4f3f37d, to HEAD 19c9907). `git diff 4f3f37d HEAD -- package.json .env.example src/config.js README.md` → EMPTY (zero deltas).
  - Full change stat: exactly 10 files, all in src/modules/pacientes/, src/db/migrations/, src/index.js (+7), tests/ — 871 insertions, none of them locked files.
  - `.env` and `.env.test` are untracked/ignored (only `.env.example` tracked) and were never added; no new env vars: grep for process.env/loadEnvFile in src/modules/pacientes → no matches; src/config.js still reads only DATABASE_URL, JWT_SECRET, PORT, JWT_EXPIRES_IN, BCRYPT_COST.
  - package.json unchanged (no new deps; deps are bcryptjs, express, jsonwebtoken, pg — all pre-existing for auth).

## Files Created/Changed (whole change)
- `src/db/migrations/002_create_patients.sql` (new, 13 lines)
- `src/modules/pacientes/domain/patient.js` (new, 93 lines)
- `src/modules/pacientes/application/ports.js` (new, 23 lines)
- `src/modules/pacientes/application/create-patient.js` (new, 100 lines)
- `src/modules/pacientes/infrastructure/repositories/pg-patient-repository.js` (new, 75 lines)
- `src/modules/pacientes/infrastructure/routes/patient.routes.js` (new, 41 lines)
- `src/index.js` (+7 lines)
- `tests/unit/pg-patient-repository.test.js` (new, 129 lines)
- `tests/unit/create-patient.test.js` (new, 167 lines)
- `tests/integration/patients.test.js` (new, 223 lines)

## Git / PR
- PR #4 `feat/pacientes-foundation` (merge e492f15), PR #5 `feat/pacientes-use-case` (merge cacc4aa), PR #6 `feat/pacientes-routes` (merge 19c9907) — all merged to main. Commits conventional, English, no AI attribution.
- `pnpm-workspace.yaml` (pre-existing untracked) never staged; `openspec/` gitignored → tasks.md/apply-progress.md edits local-only.

## Gotchas / Learnings
- created_by FK → users(id): the stub-middleware integration test MUST insert a real users row first; an arbitrary UUID yields FK violation → 500 (design risk table acknowledged).
- The integration 400-loop must use a dedicated documento for the "no row persisted" assertion — earlier tests persist rows under the shared payload documento.
- Windows/PowerShell strips double quotes from `node -e` args; use a single-quoted here-string piped to `node --input-type=module -` for inline DB scripts (used for the schema drop + verification queries).
- 4.2 must run `node --env-file=.env.test src/db/migrate.js`, NOT `pnpm db:migrate` (which loads `.env` and targets the dev DB).
- `git diff origin/main` is meaningless here (HEAD == origin/main); compare the change range `4f3f37d..HEAD` instead.
- `pnpm test` re-run's pretest hook migrates the test DB (skips when already applied) — no manual migration needed before the suite.

## Status
ALL TASKS COMPLETE: 1.1-1.6, 2.1-2.3, 3.1-3.4, 4.1-4.3. Ready for sdd-verify / sdd-archive.
