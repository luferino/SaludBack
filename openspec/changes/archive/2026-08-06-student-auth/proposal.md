# Proposal: Student Registration and Login (Auth Foundation)

## Intent

The API is a hello-world Express scaffold: no users, no DB code, no way to protect resources. Students need accounts to later reach profile, materias, and turnos; admins need a way to create them. This change builds the auth foundation — admin-originated `alta de usuario` plus username/password login — on a Clean Architecture skeleton future roles (médicos, admins) can plug into without rework.

## Business Rules

- Credential: username + password.
- Alta is admin-originated; no self-registration. Endpoint stays open now (no admin role yet) but exposes a guard seam for a future admin-only guard.
- Duplicate username rejected.
- Passwords stored hashed (bcrypt), never plaintext.
- Invalid credentials → generic 401 (no user enumeration).
- Token carries `role` + `permissions` claims from day one; post-login access gated per role.

## Scope

### In Scope
- Modular Clean Architecture skeleton: `modules/<module>/{domain,application,infrastructure}`.
- User entity + PostgreSQL persistence (`pg`).
- Registration endpoint (role `estudiante`).
- Login endpoint issuing a role/permissions token.
- Env config (`src/config.js`); `node:test` auth tests.

### Out of Scope
- Other roles and the admin authorization guard.
- Self-service registration, password recovery, email verification.
- Refresh-token rotation (defer; decide in design).
- Profile / materias / turnos endpoints — token only enables them.

### Constraints
No test runner; ESM not pinned; no env config; `src/config.js` empty; no migration tooling.

## Capabilities

> Contract for sdd-spec. `openspec/specs/` is empty — all new.

### New Capabilities
- `user-registration`: admin-originated alta of `estudiante` users; duplicate-username rejection; guard seam.
- `user-auth`: username+password login; token issuance with role/permissions claims.

### Modified Capabilities
None.

## Approach

Modular Clean Architecture: each feature lives under `modules/<module>/` with `domain/` (entity, role/permissions model, use-case ports), `application/` (use-cases, hashing policy), `infrastructure/` (Express routes, `pg` repository, bcrypt, JWT, config). This slice ships the `auth` module (`modules/auth/`) containing registration, login, and token issuance; future modules (students, materias, turnos, admins) follow the same layout, with shared code in `modules/shared/`. Hashing via `bcryptjs` (pure JS, no native build friction). Token carries `role`/`permissions`; routes pass an auth-guard boundary so admin-only enforcement is a future drop-in.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/index.js` | Modified | Mount routes, middleware, config wiring |
| `src/config.js` | Modified | DB URL, JWT secret, port |
| `modules/auth/domain/` | New | User entity, role/permissions model |
| `modules/auth/application/` | New | register/login use-cases |
| `modules/auth/infrastructure/` | New | routes, pg repo, hashing, token service |
| `modules/shared/` | New | cross-module shared code (ports, utils) |
| `package.json` | Modified | test script, bcryptjs/jsonwebtoken deps |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Weak password storage | Med | bcryptjs cost factor; tests assert hashes |
| Token blocks future roles | Med | Role+permissions claims; guard seam |
| Regressions (no test culture) | Med | node:test smoke suite for both flows |
| ESM/module-type quirks | Low | Pin module type in design |

## Rollback Plan

Remove auth routes/layers, restore `src/index.js` hello-world; drop `users` table via plain SQL. No downstream consumers depend on auth — revert is clean.

## Dependencies

- Reachable PostgreSQL dev instance (`DATABASE_URL`).
- Packages: `bcryptjs`, `jsonwebtoken` (finalized in design).

## Success Criteria

- [ ] `POST /auth/register` creates an `estudiante`; duplicate username → 409.
- [ ] `POST /auth/login` returns a token with `role: estudiante`; bad credentials → 401.
- [ ] Passwords stored as bcrypt hashes; plaintext never persisted.
- [ ] Token middleware verifies and exposes role/permissions on requests.
- [ ] `pnpm test` passes register + login flow tests.
