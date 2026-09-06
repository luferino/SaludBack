# Tasks: Password Recovery (recuperar-contrasena)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~700–800 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### PR Slice Boundaries (work units, tests with code)

**PR 1 — Foundation: config + user email (~180 lines). Base: main/tracker.**
Start: no email support. Finish: migration 003, config/env, `users.email`, register requires email, `findByEmail`/`updatePassword`. Verify: `pnpm test` green; email persisted; dup → 409. Rollback: revert code; 003 additive/harmless.

**PR 2 — Reset domain/application (~300 lines). Base: PR 1 branch.**
Start: no reset use cases. Finish: token entity, ports, both use cases + unit suites. Verify: `pnpm test` green. Rollback: revert; no schema/wiring change.

**PR 3 — Persistence, wiring, e2e (~310 lines). Base: PR 2 branch.**
Start: no pg repo/mailer/routes. Finish: both endpoints live end-to-end. Verify: `pnpm test` green; forgot→reset e2e, reuse/expired/cap. Rollback: revert; endpoints idle, table/column harmless.

## Phase 1: Foundation (PR 1)

- [x] 1.1 Create `src/db/migrations/003_add_email_and_reset_tokens.sql`: `users.email` + unique index; `password_reset_tokens` (per design D3/D4); additive, no backfill
- [x] 1.2 `src/config.js`: `CLIENT_URL` → `REQUIRED_ENV`; add `clientUrl`, `resetTokenTtl` (15), `resetTokenMaxOutstanding` (3)
- [x] 1.3 `.env.example` + `.env.test`: add `CLIENT_URL`, `RESET_TOKEN_TTL`, `RESET_TOKEN_MAX_OUTSTANDING`
- [x] 1.4 `src/modules/auth/domain/user.js`: add `email` (default null) to constructor, `create`, `toJSON`
- [x] 1.5 `src/modules/auth/application/ports.js`: add `UserRepositoryPort.findByEmail` + `updatePassword`
- [x] 1.6 `src/modules/auth/infrastructure/repositories/pg-user-repository.js`: email in columns/create/mapping; implement `findByEmail`, `updatePassword`
- [x] 1.7 `src/modules/auth/application/register-user.js`: require email, duplicate → 409, pass email to `User.create`
- [x] 1.8 Tests: extend `tests/unit/register-user.test.js` (400/409) + `tests/unit/pg-user-repository.test.js`; add email to register payloads in `tests/integration/auth.test.js`
- [x] 1.9 Verify: `pnpm test` green

## Phase 2: Reset domain/application (PR 2)

- [x] 2.1 Create `src/modules/auth/domain/password-reset-token.js` (`id, userId, tokenHash, expiresAt, usedAt, createdAt`)
- [x] 2.2 `src/modules/auth/application/ports.js`: `ResetTokenRepositoryPort` (`create` cap-enforced, `findValidByHash`, `markUsed`) + `MailerPort.sendMail`
- [x] 2.3 Create `src/modules/auth/application/request-password-reset.js`: generic 200 body; email-less/unknown → no token/mail; else `randomBytes(32)` + sha256, create, mail `${clientUrl}?token=${raw}`
- [x] 2.4 Create `src/modules/auth/application/reset-password.js`: sha256 lookup, invalid → generic 400; mark-then-update (D8); missing fields → 400
- [x] 2.5 Tests: create `tests/unit/request-password-reset.test.js` (identical bodies, hash-at-rest, link shape, no-mail) + `tests/unit/reset-password.test.js` (valid markUsed+update, generic error, 400s)
- [x] 2.6 Verify: `pnpm test` green

## Phase 3: Persistence, wiring, e2e (PR 3)

- [x] 3.1 Create `src/modules/auth/infrastructure/repositories/pg-reset-token-repository.js`: atomic cap+insert CTE (design SQL), `findValidByHash`, `markUsed`
- [x] 3.2 Create `src/modules/auth/infrastructure/services/console-mailer.js`: `sendMail` prints recipient/subject/text to stdout
- [x] 3.3 `src/modules/auth/infrastructure/routes/auth.routes.js`: `POST /forgot-password` + `POST /reset-password` (unguarded like login); inject reset repo, mailer, clientUrl
- [x] 3.4 `src/index.js`: wire `PgResetTokenRepository` + `ConsoleMailer`; pass TTL/cap from config
- [x] 3.5 Tests: create `tests/unit/pg-reset-token-repository.test.js` (fake pool: insert params + overflow SQL) + `tests/unit/console-mailer.test.js` (link on stdout)
- [x] 3.6 `tests/integration/auth.test.js`: `DELETE FROM password_reset_tokens` in `before()`; e2e register→forgot→reset (recording mailer); old fails/new works; reuse, expired, N+1 cap
- [x] 3.7 Verify: `pnpm test` green

## Phase 4: Final verification

- [x] 4.1 `pnpm test` + `pnpm db:migrate`; confirm 003 applied to test DB
- [x] 4.2 Trace spec scenarios to tests; commit per work unit
