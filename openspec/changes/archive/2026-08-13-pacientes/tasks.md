# Tasks: Patient Personal Data Entry (Pacientes Module)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~750 (10 files: 7 new src, 3 test) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation → PR 2 use case → PR 3 wiring/integration |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Basis: migration ~15, entity ~55, ports ~40, use case ~75, repo ~65, routes ~50, `src/index.js` +8, unit tests ~275, integration ~200. No env/config/README deltas (locked: no new env vars or deps; runner, guard, error-handler reused).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Migration, entity, ports, pg repo + repo unit tests | PR 1 | ~290 lines; base: main or tracker — ask user |
| 2 | CreatePatient use case + unit tests | PR 2 | ~235 lines; base: PR 1 branch |
| 3 | Routes factory, index wiring, integration tests | PR 3 | ~258 lines; base: PR 2 branch |

## Phase 1: Foundation (PR 1)

- [x] 1.1 `src/db/migrations/002_create_patients.sql`: patients DDL — UUID PK `gen_random_uuid()`, `documento TEXT NOT NULL UNIQUE`, `nombres`, `apellidos`, `fecha_nacimiento DATE NOT NULL`, `email`, `celular`, `sexo`, `direccion` NOT NULL, `created_by UUID NULL REFERENCES users(id)`, `created_at TIMESTAMPTZ DEFAULT now()`; additive, forward-only. AC: `pnpm db:migrate` applies on test DB, re-run skips.
- [x] 1.2 `src/modules/pacientes/domain/patient.js`: entity, `static create`, `toJSON()` whitelist — exactly 11 contract keys (PAT-006), `created_by` present as `null`, never omitted.
- [x] 1.3 `src/modules/pacientes/application/ports.js`: `PatientRepositoryPort` (`findByDocumento`, `create`), mirroring auth ports.
- [x] 1.4 `src/modules/pacientes/infrastructure/repositories/pg-patient-repository.js`: `PATIENT_COLUMNS`, `findByDocumento` (WHERE documento = $1), `create` RETURNING, `rowToPatient` normalizing `fecha_nacimiento` → `YYYY-MM-DD`.
- [x] 1.5 `tests/unit/pg-patient-repository.test.js`: fake pool — SQL text + params asserted; null vs row mapping; date normalization; `toJSON()` yields exactly 11 keys (PAT-006).
- [x] 1.6 Verify `pnpm db:migrate` + `pnpm test` green (pretest auto-migrates test DB).

## Phase 2: Use Case (PR 2)

- [x] 2.1 `src/modules/pacientes/application/create-patient.js`: `CreatePatient` — 8 required fields (missing/null/blank → 400); `documento` trimmed `/^\d{4,8}$/` (`12A4`, `123`, `123456789` → 400); `sexo` M|F (`m` → 400); strict `YYYY-MM-DD` valid, not future (`2026-02-31` → 400); `email` matches `local@domain` → 400; dup `findByDocumento` → `ConflictError` 409 (PAT-001..003); else `create({...fields, createdBy})`.
- [x] 2.2 `tests/unit/create-patient.test.js`: `FakePatientRepository` — success (create called once, `createdBy` passthrough); asserts `create` never called on 400/409 paths; all PAT-003 variants.
- [x] 2.3 Verify `pnpm test` green.

## Phase 3: Routes, Wiring, Integration (PR 3)

- [x] 3.1 `src/modules/pacientes/infrastructure/routes/patient.routes.js`: `createPatientRouter({ repository, guard = new OpenGuard(), getActor = defaultGetActor })`; handler: `guard.authorize(req)` → `getActor(req)` → use case → 201 `toJSON()`; `defaultGetActor(req) = req.auth?.sub ?? null` (PAT-004/005 seams).
- [x] 3.2 `src/index.js`: `new PgPatientRepository(pool)`; mount `app.use('/patients', createPatientRouter({ repository }))` — no guard/getActor passed (open, null actor).
- [x] 3.3 `tests/integration/patients.test.js`: mirror auth harness (`DELETE FROM patients` before; `listen(0)` + fetch; close server + `pool.end()` after): 201 + exact 11-key body + `created_by` null; duplicate → 409, count stays 1; 400 loop; attached throwing guard → 401, no row; stub middleware setting `req.auth.sub` → `created_by` populated; garbage Bearer on open route → 201 + `created_by` null.
- [x] 3.4 Full `pnpm test` green + curl smoke `POST /patients` (dev server).

## Phase 4: Cleanup / Verification

- [x] 4.1 Audit: responses carry only the 11 contract keys, `created_by` null when anonymous (PAT-006), no extra fields.
- [x] 4.2 Fresh-schema sanity: drop schema → `pnpm db:migrate` → `pnpm test` (002 applies once, re-runs skip).
- [x] 4.3 Confirm zero deltas to `package.json`, `.env*`, `src/config.js`, `README.md` (locked: no new env vars/deps).
