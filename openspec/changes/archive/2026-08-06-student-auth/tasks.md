# Tasks: Student Registration and Login (Auth Foundation)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation → PR 2 registration → PR 3 login |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Skeleton, config, shared/domain, migrations, pg repo + tests | PR 1 | Base: main/tracker — ask user |
| 2 | Register flow + tests | PR 2 | Base: PR 1 branch |
| 3 | Login flow + tests | PR 3 | Base: PR 2 branch |

## Phase 1: Foundation (PR 1)

- [x] 1.1 `package.json`: pin `"type": "module"`; add `bcryptjs`, `jsonwebtoken`; `test`/`db:migrate`/`pretest` scripts (paths `src/db/migrate.js`)
- [x] 1.2 `src/config.js`: validate `PORT`, `DATABASE_URL`, `JWT_SECRET` (fail fast), `JWT_EXPIRES_IN`, `BCRYPT_COST`
- [x] 1.3 `.env.example` + `.env.test`; gitignore `.env`, `.env.test`
- [x] 1.4 `modules/shared/domain/errors.js`: `AppError` + 400/409/401
- [x] 1.5 `modules/shared/application/guard.js`: `Guard` port + `OpenGuard` — spec: Admin Guard Seam
- [x] 1.6 `modules/auth/domain/user.js` + `permissions.js` (`ROLE_PERMISSIONS`) — spec: Token Claims
- [x] 1.7 `modules/auth/application/ports.js`: repo/hasher/token ports
- [x] 1.8 `src/db/migrations/001_create_users.sql` + `src/db/migrate.js` runner (ordered, idempotent)
- [x] 1.9 `modules/auth/infrastructure/repositories/pg-user-repository.js` (`findByUsername`, `create`)
- [x] 1.10 Unit tests: guard/permissions/repo (fake pool)
- [x] 1.11 Verify `pnpm db:migrate` and `pnpm test` green — DONE: local postgres password provided (1314); `saludback` + `saludback_test` created; migrate applied 001 and is idempotent (re-run: 0 new); `pnpm test` pretest migrates test DB and 10/10 unit tests pass.

## Phase 2: Registration (PR 2)

- [x] 2.1 `bcrypt-hasher.js` (`hash`, `compare`, cost from config) + roundtrip test — spec: Password Hashing
- [x] 2.2 `register-user.js`: validate → hash → dup 409 → create 201 — spec: Register Student Account
- [x] 2.3 `src/middleware/error-handler.js`: `AppError` → JSON status; unknown → 500
- [x] 2.4 `modules/auth/infrastructure/routes/auth.routes.js`: `POST /auth/register` behind `OpenGuard`
- [x] 2.5 `src/index.js`: JSON parser, mount `/auth`, error-handler last
- [x] 2.6 Unit + integration tests (201/409/400) — spec scenarios — 25 tests green incl. real-DB integration (ephemeral port, `saludback_test`)

## Phase 3: Login + Token Verification (PR 3)

- [x] 3.1 `jwt-token-service.js`: `sign` (sub/username/role/permissions/iss/aud/exp) + `verify`; unit tests — spec: Token Claims
- [x] 3.2 `login-user.js`: validate → find → compare → generic 401 → sign — spec: Login with Credentials
- [x] 3.3 `authenticate.js`: verify → `req.auth {role, permissions}`; invalid → 401 — spec: Token Verification
- [x] 3.4 `auth.routes.js`: add `POST /auth/login`
- [x] 3.5 Login unit + integration tests (200+claims/401/400)
- [x] 3.6 Full `pnpm test` green + curl smoke both flows

## Phase 4: Cleanup / Verification (PR 3)

- [x] 4.1 Audit: no plaintext password in DB/logs/responses — spec: Password Hashing
- [x] 4.2 Fresh migration sanity (drop schema → migrate → test)
- [x] 4.3 `README.md`: env setup + `pnpm db:migrate` before boot
