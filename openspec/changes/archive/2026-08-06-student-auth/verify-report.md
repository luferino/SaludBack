# Verification Report

**Status**: passed
**Overall Verdict**: PASS
**Change**: student-auth (Student Registration and Login — Auth Foundation)
**Version**: N/A (change-time specs, v1)
**Mode**: Standard
**Verified branch**: `feat/student-auth-login` (base `feat/student-auth-registration`), 6 PR-3 work-unit commits (8494550 → 8531648); full 3-PR chain present in branch history
**Date**: 2026-08-06
**Verifier**: independent sdd-verify execution (source inspection + fresh test runs; apply report not trusted)

## Scope of Verification

- Proposal: `openspec/changes/student-auth/proposal.md`
- Specs: `specs/user-registration/spec.md`, `specs/user-auth/spec.md`
- Design: `openspec/changes/student-auth/design.md`
- Tasks: `openspec/changes/student-auth/tasks.md`
- Prior apply context: Engram `sdd/student-auth/apply-progress` (observation #33) — read for context, independently re-verified here.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 26 |
| Tasks complete | 26 |
| Tasks incomplete | 0 |

Every checkbox independently confirmed against source/tests, not taken on trust:
- 1.1 ESM pin, `bcryptjs`/`jsonwebtoken`, `test`/`db:migrate`/`pretest` scripts → `package.json` lines 5, 8–12, 17–21 ✔
- 1.2 config strict startup validation on `DATABASE_URL`/`JWT_SECRET` + defaults → `src/config.js` ✔
- 1.3 `.env.example` committed; `.env`/`.env.test` gitignored and **untracked** (verified via `git ls-files`) ✔
- 1.4–1.7 errors / Guard port / domain model / ports → all present, used ✔
- 1.8 migration runner ordered + idempotent → proven by 3 consecutive runs (apply → skip) ✔
- 1.9–1.11 pg repository + unit tests + migrate/test green → re-run, green ✔
- 2.1–2.6 register flow + error handler + wiring + 201/409/400 tests → green ✔
- 3.1–3.6 JWT service, login use case, authenticate middleware, login route, tests → green ✔
- 4.1 no plaintext audit → source scan + `git grep` + tests ✔
- 4.2 fresh migration sanity → independently re-executed (drop schema → migrate → 49/49) ✔
- 4.3 README env + `pnpm db:migrate` before boot → `README.md` ✔

## Build & Tests Execution

**Build**: ✅ (no separate build step; ESM runs directly under Node 24)

**Tests**: ✅ 49 passed / 0 non-passing / 0 skipped (three independent runs)
```text
pnpm test
> pretest: node --env-file=.env.test src/db/migrate.js
> test:    node --env-file=.env.test --test

Run 1 (pre-existing test schema):  "Skipping 001_create_users.sql (already applied)" → 49 pass
Run 2 (schema dropped + recreated): fresh "Applying 001_create_users.sql..." (inferred: all 10 real-DB
        integration tests passed against the brand-new schema) → 49 pass
Run 3 (idempotency):                "Skipping 001_create_users.sql (already applied)" → pretest clean

ℹ tests 49  ℹ pass 49  ℹ skipped 0  (runs 1 and 2 full summary)
```
The `Error: secret internal detail` line printed during the run is **intentional** — the
error-handler unit test asserts unknown errors become a generic 500 without leaking the message
(`console.error` output, not a test problem).

**Coverage**: ➖ Not available (no coverage tooling configured; not required by this change).

## Spec Compliance Matrix

### user-registration (specs/user-registration/spec.md)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Register Student Account | Successful registration → 201 + role `estudiante` persisted | `tests/integration/auth.test.js > POST /auth/register creates an estudiante with a bcrypt hash` (+ unit `register-user.test.js > successful registration…`) | ✅ COMPLIANT |
| Register Student Account | Duplicate username → 409, no new user | `auth.test.js > rejects a duplicate username with 409` (+ unit ConflictError, `create` never called) | ✅ COMPLIANT |
| Register Student Account | Empty/missing fields → 400, no user created | `auth.test.js > rejects missing or empty fields with 400` (5 payloads) (+ unit) | ✅ COMPLIANT |
| Password Hashing | Plaintext never persisted; stored value is a bcrypt hash ≠ plaintext | `auth.test.js > creates an estudiante with a bcrypt hash` (regex `^\$2[aby]\$`, `!= 'secret123'`) + `pg-user-repository.test.js > toJSON never exposes the password hash` + `bcrypt-hasher.test.js` (roundtrip, salt, cost) | ✅ COMPLIANT |
| Admin Guard Seam | Seam open by default | `guard.test.js > OpenGuard allows any request` + register flow succeeds with `OpenGuard` in integration suite | ✅ COMPLIANT |
| Admin Guard Seam | Seam rejects when policy attached; use case not executed | `auth.test.js > an attached guard rejects the request before the use case runs` (AdminGuard → 401, `rejected-user` count 0) + `guard.test.js > a policy guard rejects…` | ✅ COMPLIANT |

### user-auth (specs/user-auth/spec.md)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Login with Credentials | Successful login → 200 + access token | `auth.test.js > POST /auth/login returns 200 with a token carrying role and permissions` (+ unit `login-user.test.js > successful login…`) | ✅ COMPLIANT |
| Login with Credentials | Unknown username → 401 | `auth.test.js > rejects an unknown username with a generic 401` (+ unit: compare never called, sign never called) | ✅ COMPLIANT |
| Login with Credentials | Wrong password → 401, body identical to unknown-username case | `auth.test.js > rejects a wrong password with the same body as an unknown username` (`assert.deepEqual` of bodies) + unit | ✅ COMPLIANT |
| Login with Credentials | Missing/empty fields → 400 | `auth.test.js > rejects missing or empty fields with 400` (6 payloads) + unit | ✅ COMPLIANT |
| Token Claims Contract | Token carries `role: estudiante` + non-empty `permissions` array derived from role | `auth.test.js > login returns a token carrying role and permissions` (`jwt.decode`) + unit `jwt-token-service.test.js > sign returns a token carrying the full claims contract` | ✅ COMPLIANT |
| Token Claims Contract | Token carries `iss`/`aud`/`iat`/`exp`; never the password hash | `jwt-token-service.test.js > token carries iss, aud, iat and a future exp` (`iss: 'SaludBack'`, `aud: 'SaludBack-api'`) + `token never carries the password hash` | ✅ COMPLIANT |
| Token Verification | Valid token passes; `role` + `permissions` on request | `auth.test.js > protected route passes a valid token and exposes role and permissions` (`req.auth` deepEqual) + unit `authenticate.test.js > valid Bearer token…` | ✅ COMPLIANT |
| Token Verification | Missing / malformed / expired / invalid token → 401, handler not executed | `auth.test.js > protected route rejects missing, malformed and expired tokens with 401` + unit tests (missing header, non-Bearer, malformed, expired) | ✅ COMPLIANT |

**Compliance summary**: 13/13 scenarios compliant.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Token Claims | ✅ Implemented | `JwtTokenService.sign` = `{ sub, username, role, permissions }` + jsonwebtoken `iat`/`exp` + `iss: 'SaludBack'`, `aud: 'SaludBack-api'` (service defaults, design-matching). No hash claim. `verify` enforces secret + issuer + audience. |
| Login with Credentials | ✅ Implemented | `LoginUser`: validate → `findByUsername` → `compare` → sign. Unknown-user and wrong-password paths throw the **same** `UnauthorizedError('Invalid credentials')` — identical body, no enumeration. |
| Token Verification | ✅ Implemented | `authenticate(tokenService)`: Bearer parse → verify → `req.auth = { role, permissions }`; every invalid-token path (missing/malformed/expired/wrong secret) collapses to `UnauthorizedError` → 401. |
| Register Student Account | ✅ Implemented | `RegisterUser`: validate → dup-check (409) → hash → `create` with role `estudiante` → 201. Validation covers missing/empty/whitespace username and missing/empty password. |
| Password Hashing | ✅ Implemented | `BcryptHasher(cost)` — cost injected from `config.bcryptCost` (default 12); per-password salt; hash-only persistence; `User.toJSON()` strips `passwordHash`; 201 body and login response never include it. |
| Admin Guard Seam | ✅ Implemented | `Guard` port + `OpenGuard` in `modules/shared/application/guard.js`; injected into `createAuthRouter` (default open) in front of `/register` only; login bypasses (unauthenticated entry point). |
| Error handling | ✅ Implemented | `errorHandler`: `AppError` → status + stable code; exposed 4xx middleware errors (body-parser malformed JSON) honored; unknown → generic 500, no leak. |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Modular Clean Architecture `modules/<m>/{domain,application,infrastructure}` | ✅ Yes | Auth module + `modules/shared` for errors/guard; dependency direction domain ← application ← infrastructure held (infrastructure imports ports, not vice versa). |
| JWT, no refresh rotation; `TokenService` port | ✅ Yes | `sign`/`verify` on the port; refresh later = new method. |
| Claims contract `{ sub, username, role, permissions, iat, exp, iss, aud }` | ✅ Yes | Exact defaults `iss: 'SaludBack'`, `aud: 'SaludBack-api'`. |
| `ROLE_PERMISSIONS` static map, `<resource>:<action>` | ✅ Yes | `estudiante: ['profile:read','materias:read','turnos:read']`; unknown roles → `[]`. |
| Guard seam as policy boundary (`Guard`/`OpenGuard`) | ✅ Yes | Wired at route creation; drop-in swap. |
| Versioned plain-SQL migration + runner, per-file transactions, `schema_migrations` | ✅ Yes | `src/db/migrate.js` + `001_create_users.sql`; idempotency proven by repeated runs. |
| Env via Node native `process.loadEnvFile()`, `.env.example` committed, `.env` gitignored | ✅ Yes | `src/config.js`; strict startup validation on `DATABASE_URL` + `JWT_SECRET`. |
| ESM pinned (`"type": "module"`); `bcryptjs` + `jsonwebtoken` | ✅ Yes | package.json. |
| Testing strategy (unit fakes + real-DB integration, ephemeral port, test DB) | ✅ Yes | 10 unit files + 1 integration file against `saludback_test`; pretest migrates. |

Minor doc note (no behavioral impact): `design.md` data-flow shows register as
`validate → hash → findByUsername(dup→409) → create`; the code validates and dup-checks **before**
hashing (cheaper — no wasted bcrypt on duplicates). Observable contract (dup → 409 with no create;
success → 201) is identical and covered by tests. Cosmetic ordering only.

## Security Audit

| Check | Result | Evidence |
|-------|--------|----------|
| `JWT_SECRET` strict startup validation | ✅ | `src/config.js` throws at boot when `DATABASE_URL`/`JWT_SECRET` missing. |
| `.env` / `.env.test` not committed | ✅ | `.gitignore` includes both; `git ls-files` shows only `.env.example` tracked. |
| No secrets in committed files | ✅ | `git grep -I` across tracked files: no `1314`, no `JWT_SECRET=`, no connection strings with credentials. Local `.env`/`.env.test` hold `postgres:1314` but are gitignored. |
| No plaintext password persistence | ✅ | `users.password_hash` stores bcrypt only (integration test inspects DB row); `User.toJSON()` strips it; login returns `{ token }` only. |
| No plaintext in logs | ✅ | No logging of request bodies/credentials anywhere; error handler never echoes input. |
| No user enumeration via login | ✅ | Unknown-user and wrong-password paths throw byte-identical bodies (`deepEqual` integration test). |
| No hash in token | ✅ | `jwt-token-service.test.js > token never carries the password hash`. |

## Regression Check (PR 1 / PR 2)

The full suite re-exercises PR 1 (config, errors, guard, permissions, migration, pg repository) and
PR 2 (hasher, register flow, error handler, route wiring, `src/index.js`) code paths — all green in
both runs (49/49). Fresh-schema run proves migration + registration + login on a clean database.

## Issues Found

**High-severity findings**: none

**Medium-severity findings**: none

**Low-severity suggestions**:
1. Usernames are not normalized: `register` stores the raw string (only the empty-check trims), so
   `' jperez '` registers as-is and `'jperez'` will not match at login. Consider `trim()`-normalizing
   (or rejecting surrounding whitespace) in `RegisterUser`/`LoginUser`.
2. Password accepts whitespace-only strings (`'   '` passes the truthiness check on the login side
   and non-empty check on register). Optional: enforce a minimum length / non-whitespace rule once a
   password policy exists.
3. Untracked `pnpm-workspace.yaml` (`minimumReleaseAge: 2880`) sits in the working tree, created by
   pnpm 10, not part of any PR commit — decide whether to commit it deliberately or gitignore it.
4. `package.json` still carries `"main": "index.js"` (pre-existing scaffold artifact pointing at a
   nonexistent root file). Harmless for a server, but can be cleaned while touching the manifest.

## Verdict

**PASS (archive-ready)**

All 26 tasks complete and independently confirmed; 13/13 spec scenarios compliant with passing
runtime evidence; 49/49 tests green on existing and freshly-migrated schemas; no high- or
medium-severity findings. The change is safe to archive and the 3-PR chain is ready for the
orchestrator's PR creation.
