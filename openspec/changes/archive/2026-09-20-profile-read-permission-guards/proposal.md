# Proposal: Profile Read Endpoint & Permission-Driven Guards

## Intent

The API has no read endpoints and its permission model is decorative: `ROLE_PERMISSIONS` is stamped into JWT claims, but every protected route enforces `role === 'admin'` via `AdminGuard`. Clients cannot fetch their own account data, and the claim `profile:read` (plus `materias:read`/`turnos:read`) exists with zero enforcement. This change ships the first read endpoint (`GET /auth/me`) and makes the permission system real: a `PermissionGuard` enforcing `ROLE_PERMISSIONS` on the protected routes, preserving current admin semantics and 401/403 outcomes.

## Scope

### In Scope
- **Workstream A — Profile read** (first read endpoint in the codebase):
  - `GET /auth/me`: fresh PK read from the DB by token `userId` (never trusts JWT claims for the payload); response contains ONLY `username`, `email`, `role`; 200 for profile-less accounts (e.g. bootstrapped admin); no linked profile payload (student/teacher/patient data excluded).
  - `findById` on `UserRepositoryPort` + `pg-user.repository.ts`; route factory extended to mount GET.
  - Enforced via `profile:read` (present for all roles today).
- **Workstream B — Permission-driven guards**:
  - `PermissionGuard` (shared infra, mounted after `authenticate`): 401 when unauthenticated, 403 when the required permission is absent from `req.auth.permissions`.
  - Protected routes migrate to permission checks: register → `users:write`, students → `students:write`, teachers → `teachers:write`, patients → `patients:write`. Admin access preserved via `ROLE_PERMISSIONS` (admin owns every write perm). 401/403 outcomes identical to today.
  - Permission matrix pinned: implemented perms are the four write perms + `profile:read`.
- **DECIDED (user confirmed)**: migration adding UNIQUE constraints on `students.user_id` / `teachers.user_id` to enforce the one-profile-per-account business rule (today a second profile can be linked to the same account). Includes a guarded pre-migration duplicate-check that aborts loudly with NO auto-repair if existing rows violate the constraint.

### Out of Scope
- `materias:read` / `turnos:read` enforcement — teacher matrix was always TBD; stay as inert claims. **DECIDED (user confirmed): out of scope.**
- Profile-detail endpoints (student/teacher/patient data), profile update, self-registration, token/claim format changes.

## Capabilities

### New Capabilities
- `profile-read`: `GET /auth/me` fresh-read contract, user-only payload, profile-less accounts, `profile:read` enforcement.
- `permission-guards`: enforceable permission matrix, `PermissionGuard` contract, admin-access-preserved invariant.

### Modified Capabilities
- `user-registration`: admin-role gate → `users:write` permission; 401/403 outcomes unchanged.
- `student-registration`: STU-005 guard → `students:write`.
- `teacher-registration`: TEA-004 guard → `teachers:write`.
- `patient-registration`: PAT-005 guard → `patients:write` (realizes the formerly-out-of-scope permission gate).

## Approach

Additive first: `findById` port+repo, `PermissionGuard` beside `AdminGuard` (same `Guard` port shape), GET support in the route factory. Then swap guards in the four protected routers with identical 401/403 semantics; update wiring + integration tests (middleware+guard on all mounts). `GET /auth/me` = `authenticate` + `PermissionGuard(profile:read)` + `findById` handler mapping `userId → {username, email, role}`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/shared/application/guard.ts` | Modified | Add `PermissionGuard` |
| `src/modules/auth/domain/permissions.ts` | Modified | Pin matrix (write perms + profile:read) |
| `src/modules/auth/application/auth.ports.ts` | Modified | `findById(userId)` port |
| `src/modules/auth/infrastructure/repositories/pg-user.repository.ts` | Modified | `findById` SQL |
| `src/modules/auth/infrastructure/routes/auth.routes.ts` | Modified | GET /auth/me; register guard swap |
| `src/modules/auth/application/` | New | GetCurrentUser use case |
| `src/modules/{students,teachers,patients}/infrastructure/routes/*.routes.ts` | Modified | Guard swap |
| `src/index.ts` + route factory | Modified | GET mount support; wiring |
| `src/db/migrations/` | New | UNIQUE on students.user_id, teachers.user_id + pre-migration dup check |
| `tests/unit/*`, `tests/integration/*` | Modified | Guard/permission tests, /auth/me, wiring |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Guard swap changes 403 semantics for non-admin tokens | Low | Identical outcomes spec-pinned; tests assert 401/403 per route |
| `findById` leaks sensitive fields (hash) | Med | Entity `toJSON` whitelist reused; explicit response mapper |
| Unique migration fails on existing dup rows | Med | Guarded pre-migration duplicate-check aborts loudly, no auto-repair (decided: include in this change) |
| Diff exceeds 400-line review budget | High | Tasks phase splits A/B + guard swaps into small tasks; chained PRs |

## Rollback Plan

Code: revert the commit — responses for existing endpoints keep identical status codes, so no contract break (GET /auth/me is additive). Migration: additive UNIQUE constraint; rollback via DROP CONSTRAINT (no data loss) or restore pre-change snapshot.

## Dependencies

- None external. Prereq: current auth/alta flows and shared test-DB discipline.

## Success Criteria

- [ ] `GET /auth/me` returns 200 `{username, email, role}` only — fresh DB read (mutating the user row changes the response); 401 without/with bad token
- [ ] Profile-less admin account → 200 user data only
- [ ] All protected routes: 401 unauthenticated, 403 missing-permission; admin unchanged
- [ ] PermissionGuard unit tests + wiring test covers all 5 protected mounts
- [ ] Full suite green, single test DB, no FK races