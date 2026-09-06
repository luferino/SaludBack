# Archive Report — pacientes

**Change**: pacientes — Patient Personal Data Entry (`POST /patients`)
**Archived**: 2026-08-13
**Archive path**: `openspec/changes/archive/2026-08-13-pacientes/`
**Verdict at archive time**: PASS (verify-report, no CRITICAL or WARNING issues)
**Commit verified**: `main` @ `19c9907`

## Change Summary

First feature of the `pacientes` module: staff-originated entry of patients' personal data (`alta de datos personales`) via `POST /patients`, mirroring the auth module file-for-file. Clean Architecture (`domain / application / infrastructure`) with injected ports, an additive forward-only migration (`002_create_patients.sql`), and two seams pinned in the spec for future wiring: the guard boundary (default `OpenGuard` — alta stays open) and the `getActor(req)` actor hook (default `req.auth?.sub ?? null` — `null` today, since the open route mounts no token middleware and `authenticate` does not yet expose `sub`). Satisfies capability `patient-registration` (PAT-001..PAT-006, 12 scenarios, 6 requirements).

Scope delivered: module (entity, use case, ports, pg repository, routes factory), migration, `src/index.js` mount, unit + integration test suites. Out of scope (seam-only): permission guard, patient–user linking, clinical data.

## Delivery Record

| PR | Branch | Merge commit | Content |
|----|--------|--------------|---------|
| #4 | `feat/pacientes-foundation` | `e492f15` | Migration, entity, ports, pg repository + repo unit tests |
| #5 | `feat/pacientes-use-case` | `cacc4aa` | `CreatePatient` use case + unit tests |
| #6 | `feat/pacientes-routes` | `19c9907` | Routes factory, `src/index.js` wiring, integration tests |

All three merged to `main`. Commits conventional, English, no AI attribution. Change spans `4f3f37d..19c9907`: exactly 10 files, 871 insertions; zero deltas on locked files (`package.json`, `.env.example`, `src/config.js`, `README.md`).

## Verify Verdict

**PASS** (archive-ready) — 2026-08-13, `main` @ `19c9907`.

- Tasks: 16/16 complete (`tasks.md` all `[x]`; apply-progress confirms every checkbox, task completion gate passed before archive).
- Tests: 69 passed / 0 failed / 0 skipped on real PostgreSQL (`.env.test`), including all 6 pacientes integration tests and 13 pacientes unit tests.
- Spec compliance: 13/13 scenario-requirement pairings compliant (12 spec scenarios + verified-token sub-case at body and DB level).
- Issues: CRITICAL none, WARNING none. Suggestions only (coverage tooling absent; verified-token coverage via stub middleware until real `authenticate` wiring lands).
- Correctness and design coherence independently spot-checked per task; fresh-schema migration sanity (`DROP SCHEMA` → migrate → re-run skip) executed on `saludback_test`.

## Spec Sync Note

The capability spec for this change was **already materialized** at `openspec/specs/patient-registration/spec.md` before archive. Identity verified: byte-for-byte identical to the change spec (`openspec/changes/pacientes/specs/patient-registration/spec.md`), confirmed by case-sensitive content compare. No merge performed and no file modified — the spec→capability sync is treated as complete. The main spec is the source of truth for `patient-registration`.

## Archive Contents

- `proposal.md` — intent, business rules, scope, approach, rollback plan
- `exploration.md` — optional sdd-explore artifact (pre-existing in the change folder; moved intact for audit-trail completeness)
- `specs/patient-registration/spec.md` — delta spec (PAT-001..PAT-006)
- `design.md` — architecture decisions, module structure, data model, API contracts
- `tasks.md` — 16/16 tasks complete
- `apply-progress.md` — batch-by-batch completion evidence
- `verify-report.md` — PASS with compliance matrix
- `archive-report.md` — this report

No unchecked implementation tasks in the archived `tasks.md`.

## Next Steps

None pending — the SDD cycle is closed for this change.

Future work (tracked, not blocking):
- Wire the real `authenticate` middleware additively to expose `sub` in `req.auth`, then extend the verified-token integration test to use it end-to-end (PAT-004 today is proven via a stub middleware).
- Attach a `pacientes:write` `PermissionGuard` at the route seam (PAT-005) — a wiring change only, no use-case contract change.

## skill_resolution

paths-injected — `sdd-archive` SKILL.md plus shared references (`_shared/sdd-phase-common.md`, `_shared/openspec-convention.md`, `_shared/sdd-status-contract.md`) loaded as provided by the orchestrator.
