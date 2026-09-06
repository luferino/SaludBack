# Proposal: Patient Personal Data Entry (Pacientes Module)

## Intent

The `pacientes` module is an empty scaffold; only `auth` exists. Staff need to register patients' personal data (`alta de datos personales`). This slice ships the module's first feature, mirroring auth file-for-file, so clinical data, turnos, and account linking plug in later without rework.

## Business Rules

- Fields: `documento` (number only), `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo` (`M`|`F`), `direccion`.
- `documento` UNIQUE; duplicate → 409 CONFLICT.
- Alta is OPEN now, riding auth's `OpenGuard` seam so a `pacientes:write` guard attaches later without contract rework.
- `created_by` nullable UUID → `users(id)`: from token when present, `null` anonymous.
- Missing/empty required fields → 400 BAD_REQUEST.

## Scope

### In Scope
- `pacientes` module: entity, use case, ports, pg repository, routes.
- `002_create_patients.sql` (additive; UUID PK, TIMESTAMPTZ).
- `POST /patients` behind `OpenGuard`, wired in `src/index.js`.
- Unit + integration tests mirroring auth.

### Out of Scope
- Clinical data, turnos, materias.
- Patient–user account linking.
- Permission guard (seam only).

### Constraints
No new env vars/deps; forward-only runner (`002` additive only).

## Capabilities

> Contract for sdd-spec. `openspec/specs/` has only `user-auth` + `user-registration`.

### New Capabilities
- `patient-registration`: `POST /patients` alta; `documento` uniqueness → 409; `created_by` audit; guard seam.

### Modified Capabilities
None.

## Approach

Mirror auth: `src/modules/pacientes/{domain,application,infrastructure}` — `Patient` entity (`static create`, `toJSON()`), `CreatePatient` use case (validate → 400, dup `documento` → 409, create), `PatientRepository` port, `PgPatientRepository`, `createPatientRouter({ repository, guard = new OpenGuard() })` with `guard.authorize(req)` before the use case. `created_by` uses an actor seam on the request (null today — route open, `sub` not yet exposed by `authenticate`). Migration `002` + mount in `src/index.js`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/pacientes/` | New | domain, application, infrastructure |
| `src/db/migrations/002_create_patients.sql` | New | patients DDL |
| `src/index.js` | Modified | mount `/patients` |
| `tests/unit/`, `tests/integration/patients.test.js` | New | suites mirroring auth |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `created_by` extraction (`authenticate` omits `sub`) | Med | Actor seam + `null` fallback; pinned in spec |
| Sensitive health data | Med | `toJSON()` whitelist; no clinical fields here |
| Forward-only migrations | Low | `002` additive; rollback = `DROP TABLE` |

## Rollback Plan

Remove `/patients` mount + module; `DROP TABLE patients`. No consumers — clean revert.

## Dependencies

- Reachable PostgreSQL (already required; no new env vars).

## Success Criteria

- [ ] `POST /patients` creates; duplicate `documento` → 409.
- [ ] Missing/empty fields → 400.
- [ ] `created_by` `null` anonymous, populated with token actor.
- [ ] `pnpm test` green (49 + new).
