# Design: Patient Personal Data Entry (Pacientes Module)

## Technical Approach

Mirror the auth module's Clean Architecture file-for-file: `src/modules/pacientes/{domain,application,infrastructure}`. `POST /patients` is an application-layer use case (`CreatePatient`) with injected ports (`PatientRepository`), fronted by the shared `Guard` policy boundary (default `OpenGuard` — alta stays open) and a new `getActor(req)` hook for `created_by` attribution. Persistence is a plain-SQL additive migration (`002_create_patients.sql`) applied by the existing forward-only runner. Satisfies `patient-registration` (PAT-001..PAT-006). No new env vars or dependencies; shared `errors.js`, `guard.js`, and the error handler are reused unchanged.

## Architecture Decisions

### Decision: Guard seam — OpenGuard default

**Choice**: router factory accepts `guard = new OpenGuard()`; each handler calls `await guard.authorize(req)` before the use case. No `PermissionGuard` in this change.
**Alternatives**: implement a `pacientes:write` guard now; inline policy check in the handler.
**Rationale**: mirrors auth's register route (PAT-005). Swapping the policy later is a wiring change, never a use-case change.

### Decision: Actor hook — `getActor(req)` defaults to null

**Choice**: factory accepts `getActor = defaultGetActor`:

```js
export async function defaultGetActor(req) {
  return req.auth?.sub ?? null;
}
```

**Alternatives**: redesign `authenticate` to expose `sub` today; derive the actor inside the use case.
**Rationale**: an honest seam. `authenticate` today exposes only `{ role, permissions }` (login tokens carry `sub`, but the middleware drops it) and the open route mounts no middleware, so `req.auth` is `undefined` → actor `null` (PAT-004 anonymous and invalid-token scenarios). When a guard or token middleware later sets `req.auth.sub`, the default hook surfaces it with zero contract change (PAT-004 verified-token scenario). `authenticate` is untouched beyond what this seam needs.

### Decision: `documento` as TEXT with app-level validation

**Choice**: `documento TEXT NOT NULL UNIQUE`; the use case enforces `/^\d{4,8}$/` on the trimmed value.
**Alternatives**: `BIGINT` (drops leading zeros — `00123456` round-trips as `123456`); `NUMERIC` (overkill).
**Rationale**: 4-8 digit strings may carry leading zeros; TEXT preserves the exact value and keeps validation in the domain layer, matching 001's inline-UNIQUE style. The UNIQUE constraint is the concurrency backstop; the pre-check makes dup → 409 the normal path (a race → 500, same as auth's username).

### Decision: `sexo` and `fecha_nacimiento` column types

**Choice**: `sexo TEXT NOT NULL` (app validates `M|F`), `fecha_nacimiento DATE NOT NULL` (app validates strict `YYYY-MM-DD`, not future).
**Alternatives**: `CHECK (sexo IN ('M','F'))`; `TEXT` for the date.
**Rationale**: follows 001 conventions (no CHECK constraints; domain is the single source of truth); DATE gives real date semantics; strict round-trip validation rejects `2026-02-31` where JS `Date` coercion would silently roll over.

## Module Structure

```
src/modules/pacientes/
├── domain/patient.js                          # Patient entity: static create + toJSON() whitelist
├── application/ports.js                       # PatientRepositoryPort
├── application/create-patient.js              # CreatePatient use case (validate → dup check → create)
└── infrastructure/
    ├── routes/patient.routes.js               # createPatientRouter({ repository, guard, getActor })
    └── repositories/pg-patient-repository.js  # PATIENT_COLUMNS + rowToPatient
```

Dependency direction `domain ← application ← infrastructure`; shared `errors.js` / `guard.js` reused. No services or middleware needed (no hashing, no token).

## Data Flow

```
POST /patients ──> guard.authorize(req) ──> getActor(req) ──> CreatePatient.execute
     │                 │ (401 if policy)       │ (null today)
     │                 └───────────────────────┴──> validate (400) ──> findByDocumento (dup ──> 409)
     └─────────── 201 Patient.toJSON() <── create (INSERT ... RETURNING)
```

## Data Model

`src/db/migrations/002_create_patients.sql`:

```sql
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento TEXT NOT NULL UNIQUE,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  email TEXT NOT NULL,
  celular TEXT NOT NULL,
  sexo TEXT NOT NULL,
  direccion TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Additive, follows `001` conventions (UUID PK, TIMESTAMPTZ, inline UNIQUE). Nullable `created_by` FK → `users(id)`, no `ON DELETE` clause (users are not deleted).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/modules/pacientes/domain/patient.js` | Create | entity, `static create`, `toJSON()` whitelist |
| `src/modules/pacientes/application/ports.js` | Create | `PatientRepositoryPort` |
| `src/modules/pacientes/application/create-patient.js` | Create | validation → 400, dup → 409, create |
| `src/modules/pacientes/infrastructure/routes/patient.routes.js` | Create | router factory, guard + getActor seams |
| `src/modules/pacientes/infrastructure/repositories/pg-patient-repository.js` | Create | `PATIENT_COLUMNS`, `rowToPatient` |
| `src/db/migrations/002_create_patients.sql` | Create | patients DDL |
| `src/index.js` | Modify | `new PgPatientRepository(pool)`; `app.use('/patients', createPatientRouter({ repository }))` |
| `tests/unit/create-patient.test.js` | Create | use case with fakes |
| `tests/unit/pg-patient-repository.test.js` | Create | SQL/mapping/whitelist |
| `tests/integration/patients.test.js` | Create | HTTP smoke mirroring auth |

## API Contracts

`POST /patients` — request body (all eight required):

```json
{ "documento": "35123456", "nombres": "Ana", "apellidos": "Lopez",
  "fecha_nacimiento": "1990-04-12", "email": "ana@mail.com", "celular": "+5491100000000",
  "sexo": "F", "direccion": "Av. Siempre Viva 742" }
```

201 response — exactly these keys, nothing else (`Patient.toJSON()` whitelist):

```json
{ "id": "uuid", "documento": "35123456", "nombres": "Ana", "apellidos": "Lopez",
  "fecha_nacimiento": "1990-04-12", "email": "ana@mail.com", "celular": "+5491100000000",
  "sexo": "F", "direccion": "Av. Siempre Viva 742", "created_by": null, "created_at": "..." }
```

Errors (existing `errorHandler`, unchanged):

```json
400 → { "error": { "code": "BAD_REQUEST", "message": "..." } }
409 → { "error": { "code": "CONFLICT", "message": "documento already exists: ..." } }
```

The entity stores camelCase (`fechaNacimiento`, `createdBy`, `createdAt`); `toJSON()` maps to the snake_case contract explicitly — a whitelist object literal, not a spread (unlike `User.toJSON`). `created_by` is present as `null`, never omitted.

### Actor hook contract

`getActor(req) → Promise<string|null>`, resolved before the use case; its result becomes `createdBy`. Default returns `req.auth?.sub ?? null`; `src/index.js` passes nothing today (open route → null). Future wiring without contract change: extend `authenticate` additively with `sub: decoded.sub` in `req.auth` (or let a guard set it), then mount it — the default hook picks the value up unchanged.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `CreatePatient`: success (repo `create` called once, `createdBy` passthrough); missing/blank each field → `BadRequestError`; `documento` `12A4` / `123456789` / `123` → 400; `sexo` `m` → 400; `fecha_nacimiento` `2026-02-31` / future → 400; bad email → 400; duplicate `documento` → `ConflictError` | `node:test` + `FakePatientRepository` (records calls; asserts `create` never called on validation/dup paths) |
| Unit | `PgPatientRepository`: SQL text + params asserted on a fake pool; `findByDocumento` null/row mapping; `rowToPatient` normalizes `fecha_nacimiento` to `YYYY-MM-DD`; `toJSON()` yields exactly the 11 contract keys | fake pool |
| Integration | `POST /patients`: 201 + contract body + `created_by` null (anonymous); duplicate → 409, row count stays 1; bad payloads → 400 loop; attached throwing guard → 401 and no row; stub middleware setting `req.auth.sub` → `created_by` populated; garbage Bearer header on the open route → 201 + `created_by` null | real pool on `.env.test`, `DELETE FROM patients` before, `listen(0)` + `fetch`, close server + `pool.end()` after |

## Migration / Rollout

`pnpm pretest` / `pnpm db:migrate` applies `002_create_patients.sql` in filename order, per-file transaction, recorded in `schema_migrations`. The runner is forward-only — no rollback; revert by manual `DROP TABLE patients` and unmounting the route. No consumers depend on it.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `req.auth.sub` never set today → verified-token scenario provable only via the seam/stub | Med | `getActor` contract pinned in the spec; additive `authenticate` `sub` copy documented as the future wiring |
| `created_by` FK to a non-existent UUID → 500 | Low | actor ids come only from verified tokens; acceptable |
| pg `DATE` → JS `Date` leaks a time component in the response | Med | `rowToPatient` normalizes to `YYYY-MM-DD` |
| Shared test DB between suites | Low | `patients` / `users` tables independent; each suite cleans its own |

## Open Questions

None blocking. Later: `medico`/`admin` permission names; extended `sexo` values; document types.
