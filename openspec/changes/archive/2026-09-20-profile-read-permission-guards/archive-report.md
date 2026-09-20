# Archive Report — profile-read-permission-guards

**Change**: profile-read-permission-guards
**Archived**: 2026-09-20
**Archived to**: `openspec/changes/archive/2026-09-20-profile-read-permission-guards/`
**Artifact store**: openspec (file-based)
**Archive type**: standard (full cycle, no warnings)

---

## Change Summary

Added the first read endpoint (`GET /auth/me` — fresh primary-key database read returning exactly `username`/`email`/`role` behind the `profile:read` permission), introduced the shared `PermissionGuard` policy seam, pinned the implemented permission matrix (5 permissions; `materias:read` / `turnos:read` remain inert), swapped the four write mounts (`register`, `students`, `teachers`, `patients`) and `/auth/me` from the admin-role gate to permission gates, and shipped migration 005 adding UNIQUE constraints on `students.user_id` / `teachers.user_id` with a pre-DDL duplicate check. Delivered as 3 chained PR slices (A profile-read → B guards → C migration, PRs #16/#17).

## Artifacts Archived

- `proposal.md` ✅
- `specs/` ✅ — 6 delta specs: `profile-read` (full), `permission-guards` (full), `user-registration` (delta), `student-registration` (delta), `teacher-registration` (delta), `patient-registration` (delta)
- `design.md` ✅
- `tasks.md` ✅ — 17/17 tasks complete, 0 unchecked implementation tasks
- `verify-report.md` ✅ — verdict READY_FOR_ARCHIVE

## Spec Sync Summary

Delta specs merged into the canonical tree at `openspec/specs/` before the folder move:

| Domain | Action | Details |
|--------|--------|---------|
| `profile-read` | Created (new) | Full delta copied to `openspec/specs/profile-read/spec.md` — PR-001, PR-002 (6 scenarios) |
| `permission-guards` | Created (new) | Full delta copied to `openspec/specs/permission-guards/spec.md` — PG-001, PG-002, PG-003 (7 scenarios) |
| `user-registration` | Updated | MODIFIED `Admin-Only Registration`: gate changed from admin-role (`AdminGuard`) to `users:write` (`PermissionGuard`); scenario `Non-admin token rejected` replaced by `Token without users:write rejected`; added `Admin token still accepted`. Other requirements preserved. |
| `student-registration` | Updated | MODIFIED STU-005 (permission gate + replaced `Non-admin token rejected` with `Token without students:write rejected`, added `Admin token still accepted`); ADDED STU-006 `One Profile Per Account` (3 scenarios). Other requirements preserved. |
| `teacher-registration` | Updated | MODIFIED TEA-004 (permission gate, same scenario evolution as STU-005); ADDED TEA-005 `One Profile Per Account` (3 scenarios). Other requirements preserved. |
| `patient-registration` | Updated | MODIFIED PAT-005 (permission gate; added `Token without patients:write rejected` and `Admin token still accepted`, kept `Expired token rejected`); removed the now-realized Non-Goal bullet "Permission checks beyond the admin role gate (e.g. per-resource `pacientes:write` scoping)". PAT-004 preserved (not in delta; still behaviorally accurate). |

**Coherence edits (recorded)**: each updated spec's Purpose section had its gate-mechanism phrase updated from "a verified `admin` Bearer token is required" to "a verified Bearer token holding the `<X>:write` permission (owned by the admin role) is required", matching the delta requirement text. Non-destructive language-only alignment; no requirements other than the delta's were removed or renamed.

**Merge rule compliance**: all MODIFIED blocks replaced their full matching requirement (including the delta's `(Previously: ...)` notes); ADDED requirements appended inside the Requirements section before Non-Goals; requirements not mentioned in the deltas (STU-001…004, TEA-001…003, PAT-001…004/006/007, Register Student Account, Password Hashing, both new full specs) preserved verbatim.

## Verification Evidence

- Verdict: **PASS — READY_FOR_ARCHIVE** (`openspec/changes/archive/2026-09-20-profile-read-permission-guards/verify-report.md`), verified 2026-09-20 on `main` @ `385e2c5`.
- Independent `pnpm test` run: **303 passed / 0 failed / 0 skipped**; pretest confirmed migration 005 applied; direct DB query confirmed migrations `001`–`005` and both UNIQUE constraints (`students_user_id_unique`, `teachers_user_id_unique`).
- `tasks.md`: 17/17 tasks `[x]`, verified by inspection — no unchecked implementation tasks at archive time.
- Compliance: 14/14 requirements, 34/36 scenarios COMPLIANT (2 PARTIAL: per-mount expired-token literal coverage for `/teachers` and `/patients` — mechanism proven on the shared `authenticate` middleware via other mounts). No CRITICAL, no WARNING.

## Archive Notes

- `git mv` used for the folder move; history preserved for all tracked artifacts.
- `verify-report.md` was **untracked** at archive time (never committed by the verify phase); it moved physically with the folder and must be committed together with the archive move and the canonical spec merges.
- New canonical specs `openspec/specs/profile-read/` and `openspec/specs/permission-guards/` are new untracked files; the 4 updated canonical specs are modified tracked files. All spec-sync work is openspec artifacts only — no implementation code or tests touched.