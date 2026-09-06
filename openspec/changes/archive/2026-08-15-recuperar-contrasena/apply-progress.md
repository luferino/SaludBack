# Apply Progress — recuperar-contrasena

**Change**: recuperar-contrasena
**Phase**: Apply (PR 1 Foundation + PR 2 Reset domain/application + PR 3 Persistence/wiring/e2e + Phase 4 Final verification)
**Mode**: Standard (strict_tdd: false)
**Date**: 2026-08-15
**Branches**: PR 1 `feat/recuperar-contrasena-01-foundation` (merged to tracker at `660efb7`) · PR 2 `feat/recuperar-contrasena-02-domain` (tip `db55d3f`) · PR 3 `feat/recuperar-contrasena-03-wiring` (child of PR 2 branch, base = `feat/recuperar-contrasena-02-domain`, tip `4e19b38`) · Phase 4 on tracker `feat/recuperar-contrasena` (local tip `3d81993`, synced with remote at `3cf3ac3`)

## Workload / PR Boundary

- Mode: final batch (tracker branch). All prior chained-PR slices (PR 1–3) are merged into the tracker; Phase 4 runs directly on `feat/recuperar-contrasena`. No new PRs in this batch (orchestrator handles the tracker PR and final merge after verify). No pushes made.
- Current work unit: Phase 4 — Final verification.
- Boundary: tasks 4.1–4.2. Start: full feature merged on tracker, 99/99 tests green. Finish: `pnpm test` + `pnpm db:migrate` both green with 003 confirmed on dev + test DBs; complete spec-to-test trace with the D7 gap closed (test added); suite at 100/100.
- PR 1 (prior slice): tasks 1.1–1.9 — migration 003, config/env, `users.email`, register requires email, `findByEmail`/`updatePassword`. 299 changed lines (264+/35-).
- PR 2 (prior slice): tasks 2.1–2.6 — token entity, ports, both use cases + unit suites. 401 changed lines (401+/0-).
- PR 3 (prior slice): tasks 3.1–3.7 — pg repo/mailer/routes + e2e. 450 changed lines (446+/4-) across 7 files — 50 over the nominal 400-line budget; flagged to the orchestrator in the PR 3 batch (all-insertion, tests ship with behavior).
- Phase 4 review budget impact: 31 insertions (1 file, the D7 integration test) — well under budget.

## Completed Tasks (cumulative)

| Task | Status | Evidence |
|------|--------|----------|
| 1.1 Migration `003_add_email_and_reset_tokens.sql` | ✅ (PR 1) | `users.email` (nullable) + unique index; `password_reset_tokens` (D3 sha256 `token_hash UNIQUE`, D4 `used_at`/`expires_at`); additive, no backfill; applied to `saludback_test` by pretest hook |
| 1.2 `src/config.js` | ✅ (PR 1) | `CLIENT_URL` added to `REQUIRED_ENV`; config exposes `clientUrl`, `resetTokenTtl` (default 15), `resetTokenMaxOutstanding` (default 3) |
| 1.3 `.env.example` + `.env.test` | ✅ (PR 1) | `CLIENT_URL`, `RESET_TOKEN_TTL`, `RESET_TOKEN_MAX_OUTSTANDING` added to both (`.env.test` is gitignored — local only) |
| 1.4 `user.js` | ✅ (PR 1) | `email = null` default in constructor, `create`, and (via spread) `toJSON` |
| 1.5 `ports.js` | ✅ (PR 1) | `UserRepositoryPort.findByEmail` + `updatePassword` declared with docs |
| 1.6 `pg-user-repository.js` | ✅ (PR 1) | `email` in `USER_COLUMNS`, INSERT, `rowToUser`; implemented `findByEmail` (null-safe) and `updatePassword` (hash replace) |
| 1.7 `register-user.js` | ✅ (PR 1) | Email required (missing/blank → 400 `BadRequestError`), validated with create-patient regex `^[^@\s]+@[^@\s]+$` (D10), duplicate email → 409 `ConflictError`, passed to `User.create` |
| 1.8 Tests | ✅ (PR 1) | `register-user.test.js`: success-with-email, duplicate email 409, email 400s; `pg-user-repository.test.js`: findByEmail null/map, create params with email, updatePassword SQL; `auth.test.js`: emails in all register payloads, persisted-email assert, duplicate-email 409, email 400 payloads |
| 1.9 Verify | ✅ (PR 1) | `pnpm test`: 75/75 pass (migration 003 applied to test DB first) |
| 2.1 `password-reset-token.js` | ✅ (PR 2) | Token entity (`id, userId, tokenHash, expiresAt, usedAt, createdAt`) + `create` factory; mirrors `user.js` plain-entity style |
| 2.2 `ports.js` | ✅ (PR 2) | `ResetTokenRepositoryPort` (`create` cap-enforced, `findValidByHash`, `markUsed`) + `MailerPort.sendMail`, JSDoc'd and throwing not-implemented, matching existing port idiom |
| 2.3 `request-password-reset.js` | ✅ (PR 2) | Generic 200 body `{ message: 'If the account exists, a password reset link has been sent' }` on every non-400 path (D6); unknown/email-less fold into no token/no mail; else `randomBytes(32).toString('hex')` + sha256, `create({ userId, tokenHash, expiresAt })`, `mailer.sendMail({ to, subject, text: \`${clientUrl}?token=${raw}\` })`; clientUrl/resetTokenTtl injected (D9), no env in use case |
| 2.4 `reset-password.js` | ✅ (PR 2) | sha256 lookup via `findValidByHash`; null → generic 400 `'Invalid or expired reset token'` (D5); `markUsed` BEFORE `updatePassword` (D8); missing/blank token or missing newPassword → 400; returns `{ message: 'Password has been reset' }` |
| 2.5 Tests | ✅ (PR 2) | `request-password-reset.test.js` (7 tests): identical bodies across 3 outcomes, hash-at-rest (stored hash = sha256 of raw token in link, raw never stored), link shape `{clientUrl}?token=<64-hex>`, no-mail for unknown/email-less, expiresAt window, username 400s; `reset-password.test.js` (6 tests): valid markUsed+update with call args, D8 order assertion (markUsed before updatePassword), generic error on null token + password untouched, token/newPassword 400s |
| 2.6 Verify | ✅ (PR 2) | `pnpm test`: 88/88 pass (75 prior + 13 new) |
| 3.1 `pg-reset-token-repository.js` | ✅ | `PgResetTokenRepository extends ResetTokenRepositoryPort` (pool + maxOutstanding injected); `create` enforces D4 cap atomically in ONE statement (mark-first, see Deviations); `findValidByHash` (`used_at IS NULL AND expires_at > now()`); `markUsed`; `rowToToken` mapping |
| 3.2 `console-mailer.js` | ✅ | `ConsoleMailer extends MailerPort`; `sendMail` prints `To:`, `Subject:`, and the reset link to stdout (D1 console transport) |
| 3.3 `auth.routes.js` | ✅ | `POST /forgot-password` + `POST /reset-password`, unguarded like login (no `guard.authorize`); factory now injects `resetTokenRepository`, `mailer`, `clientUrl`, `resetTokenTtl`; use cases constructed inside the factory |
| 3.4 `src/index.js` | ✅ | Wired `new PgResetTokenRepository(pool, config.resetTokenMaxOutstanding)` + `new ConsoleMailer()`; passed `clientUrl: config.clientUrl` and `resetTokenTtl: config.resetTokenTtl` to the routes factory |
| 3.5 Tests | ✅ | `pg-reset-token-repository.test.js` (4): create statement asserts INSERT `VALUES ($1,$2,$3)`, `OFFSET $4 - 1`, overflow `used_at IS NULL` ordering, params `[userId, tokenHash, expiresAt, cap]`, entity mapping; findValidByHash null/map + SQL; markUsed SQL; `console-mailer.test.js` (1): stdout capture asserts the 3 printed lines incl. link |
| 3.6 Integration | ✅ | `DELETE FROM password_reset_tokens` added in `before()`; `RecordingMailer` (messages + clear) injected into `buildApp` with `PgResetTokenRepository(pool, cap)`; helpers `forgot`/`reset`; 6 new tests: forgot mails link to user with email; identical generic body + no mail for unknown/email-less (direct NULL-email insert); reset 400s; full forgot→reset e2e (old fails 401, new works 200, reuse → 400 `Invalid or expired reset token`); expired token (direct SQL insert, past expiry) → 400 + password unchanged; N+1 cap (issue cap+1 → cap outstanding, oldest used) |
| 3.7 Verify | ✅ | `pnpm test`: 99/99 pass (88 prior + 11 new: 4 repo unit + 1 mailer unit + 6 integration) |
| 4.1 Final verify | ✅ (this batch) | `pnpm test`: 99/99 pass (pretest hook output: `Skipping 003_add_email_and_reset_tokens.sql (already applied)` → 003 confirmed applied to test DB); `pnpm db:migrate`: `Applying 003_add_email_and_reset_tokens.sql... Applied 1 new file(s)` → 003 applied cleanly to dev DB (was missing there). Post-check on both DBs: `schema_migrations` = 001, 002, 003; `users.email` column present; `password_reset_tokens` table exists. |
| 4.2 Spec-to-test trace + D7 gap | ✅ (this batch) | Full trace table below (17 spec scenarios: 16 COVERED, 0 NOT COVERED after this batch). D7 gap found & closed: added integration test `a pre-reset access token stays valid on protected routes after the password reset` (register → login → forgot → reset → pre-reset JWT still accepted on a protected route), committed as `3d81993` `test(auth): cover pre-reset JWT validity after password reset`. Suite: 100/100 pass. |

## Spec-to-Test Trace (task 4.2)

### password-recovery spec (`specs/password-recovery/spec.md`)

| Scenario | Test file | Test name | Status |
|----------|-----------|-----------|--------|
| Forgot-password request — User with email | `tests/unit/request-password-reset.test.js` | `user with email gets a token and a mailed link; body is the generic success` | ✅ COVERED |
| Forgot-password request — User with email (e2e) | `tests/integration/auth.test.js` | `POST /auth/forgot-password mails a reset link to a user with email` | ✅ COVERED |
| Forgot-password request — Unknown username | `tests/unit/request-password-reset.test.js` | `unknown username returns identical body with no token and no mail` | ✅ COVERED |
| Forgot-password request — User without email | `tests/unit/request-password-reset.test.js` | `user without email returns identical body with no token and no mail` | ✅ COVERED |
| Forgot-password request — identical body across outcomes | `tests/unit/request-password-reset.test.js` | `identical body across all three outcomes` | ✅ COVERED |
| Forgot-password request — unknown + email-less e2e | `tests/integration/auth.test.js` | `POST /auth/forgot-password is identical for unknown and email-less users and mails nothing` | ✅ COVERED |
| Reset token lifecycle — Hash at rest | `tests/unit/request-password-reset.test.js` | `hash at rest: the stored token hash is the sha256 of the raw token in the mailed link` | ✅ COVERED |
| Reset token lifecycle — Per-user cap enforced | `tests/unit/pg-reset-token-repository.test.js` | `create runs the atomic cap+insert statement with user, token and cap params` (overflow `OFFSET $4 - 1` SQL) | ✅ COVERED |
| Reset token lifecycle — Per-user cap enforced (e2e) | `tests/integration/auth.test.js` | `issuing beyond the outstanding cap invalidates the oldest token` | ✅ COVERED |
| Reset link target — Link shape | `tests/unit/request-password-reset.test.js` | `link shape is {clientUrl}?token=<raw 32-byte token>` | ✅ COVERED |
| Reset link target — Link shape (e2e) | `tests/integration/auth.test.js` | `POST /auth/forgot-password mails a reset link to a user with email` (asserts `text.startsWith(config.clientUrl + '?token=')`) | ✅ COVERED |
| Reset link target — `CLIENT_URL` required (boot-fail) | `src/config.js` | `CLIENT_URL` in `REQUIRED_ENV` (enforced at boot); no dedicated test — covered by code inspection, consistent with existing config handling | ✅ COVERED (by construction, no dedicated test) |
| Reset password — Valid reset | `tests/unit/reset-password.test.js` | `valid token: looks up by sha256, marks used, then replaces the password hash` | ✅ COVERED |
| Reset password — Valid reset (e2e) | `tests/integration/auth.test.js` | `forgot then reset: old password stops working, new one works, token is single-use` | ✅ COVERED |
| Reset password — Invalid token (generic error, unchanged) | `tests/unit/reset-password.test.js` | `unknown, used, or expired token throws one generic error and never touches the password` | ✅ COVERED |
| Reset password — Invalid token (expired e2e) | `tests/integration/auth.test.js` | `an expired reset token is rejected with the password unchanged` | ✅ COVERED |
| Reset password — Invalid token (reuse e2e) | `tests/integration/auth.test.js` | `forgot then reset: … token is single-use` (reuse → 400 `Invalid or expired reset token`) | ✅ COVERED |
| Mailer port seam — Delivery through the port | `tests/unit/request-password-reset.test.js` | `user with email gets a token and a mailed link…` (asserts `sendMail` called with recipient) | ✅ COVERED |
| Mailer port seam — Console transport prints link | `tests/unit/console-mailer.test.js` | `sendMail prints recipient, subject and the reset link to stdout` | ✅ COVERED |
| Existing sessions unaffected — Pre-reset token still valid | `tests/integration/auth.test.js` | `a pre-reset access token stays valid on protected routes after the password reset` — **ADDED in this batch** (was NOT COVERED; design D7) | ✅ COVERED |

### user-accounts spec (`specs/user-accounts/spec.md`)

| Scenario | Test file | Test name | Status |
|----------|-----------|-----------|--------|
| Email required — Successful registration with email | `tests/unit/register-user.test.js` | `successful registration creates an estudiante with a hashed password and email` | ✅ COVERED |
| Email required — Successful registration with email (e2e) | `tests/integration/auth.test.js` | `POST /auth/register creates an estudiante with a bcrypt hash and email` (email persisted, hash never exposed) | ✅ COVERED |
| Email required — Missing or malformed email | `tests/unit/register-user.test.js` | `missing, empty or malformed email throws BadRequestError` | ✅ COVERED |
| Email required — Missing or malformed email (e2e) | `tests/integration/auth.test.js` | `POST /auth/register rejects missing or empty fields with 400` (payloads include missing email + `not-an-email`) | ✅ COVERED |
| Email required — Duplicate email | `tests/unit/register-user.test.js` | `duplicate email throws ConflictError and does not create` | ✅ COVERED |
| Email required — Duplicate email (e2e) | `tests/integration/auth.test.js` | `POST /auth/register rejects a duplicate email with 409` | ✅ COVERED |
| Legacy users keep NULL email — Existing rows untouched | `tests/integration/auth.test.js` | `POST /auth/forgot-password is identical for unknown and email-less users and mails nothing` (direct `email = NULL` insert proves nullable column + email-less handling); migration additive/no-backfill by inspection (`003_add_email_and_reset_tokens.sql`) | ✅ COVERED |
| Recovery denied without email | `tests/unit/request-password-reset.test.js` | `user without email returns identical body with no token and no mail` | ✅ COVERED |
| Recovery denied without email (e2e) | `tests/integration/auth.test.js` | `POST /auth/forgot-password is identical for unknown and email-less users and mails nothing` | ✅ COVERED |
| User lookup/update — Find by email | `tests/unit/pg-user-repository.test.js` | `findByEmail returns null when no user matches` + `findByEmail maps a database row to a User` | ✅ COVERED |
| User lookup/update — Password replaced | `tests/unit/pg-user-repository.test.js` | `updatePassword replaces the hash for the given user id` | ✅ COVERED |
| User lookup/update — Password replaced (e2e) | `tests/integration/auth.test.js` | `forgot then reset: old password stops working, new one works, token is single-use` (old → 401, new → 200) | ✅ COVERED |

**Trace summary**: 17 spec scenarios across both specs (10 password-recovery + 7 user-accounts) — **16 COVERED prior to this batch, 1 gap (D7 pre-reset JWT) found and CLOSED this batch. NOT COVERED after this batch: 0.** No formal waiver needed; the D7 test was added (recommended option).

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `src/modules/auth/infrastructure/repositories/pg-reset-token-repository.js` | Created | PG reset-token adapter: atomic cap-enforced `create`, `findValidByHash`, `markUsed` (PR 3) |
| `src/modules/auth/infrastructure/services/console-mailer.js` | Created | `MailerPort` console transport printing recipient/subject/link to stdout (PR 3) |
| `src/modules/auth/infrastructure/routes/auth.routes.js` | Modified | Added unguarded `POST /forgot-password` + `POST /reset-password`; injected reset repo/mailer/clientUrl/resetTokenTtl (PR 3) |
| `src/index.js` | Modified | Wired `PgResetTokenRepository` + `ConsoleMailer`; passed TTL/cap/clientUrl from config (PR 3) |
| `tests/unit/pg-reset-token-repository.test.js` | Created | 4 tests — fake pool asserts atomic cap+insert SQL + params, findValidByHash null/map, markUsed (PR 3) |
| `tests/unit/console-mailer.test.js` | Created | 1 test — stdout capture asserts recipient/subject/link lines (PR 3) |
| `tests/integration/auth.test.js` | Modified | PR 3: `DELETE FROM password_reset_tokens` in `before()`; RecordingMailer harness; 6 e2e tests. Phase 4: +1 test `a pre-reset access token stays valid on protected routes after the password reset` (31 insertions) closing the D7 spec gap |
| `openspec/changes/recuperar-contrasena/tasks.md` | Modified | 4.1 + 4.2 marked `[x]` (gitignored, persistence only) |
| `openspec/changes/recuperar-contrasena/apply-progress.md` | Modified | This cumulative artifact (gitignored, persistence only) |

PR 1 files (already merged to tracker, preserved): `003_add_email_and_reset_tokens.sql`, `src/config.js`, `.env.example`, `src/modules/auth/domain/user.js`, `src/modules/auth/application/ports.js` (user methods), `pg-user-repository.js`, `register-user.js`, `auth.routes.js`, `tests/unit/register-user.test.js`, `tests/unit/pg-user-repository.test.js`, `tests/integration/auth.test.js`.
PR 2 files (preserved): `src/modules/auth/domain/password-reset-token.js`, `src/modules/auth/application/ports.js` (reset-token + mailer methods), `request-password-reset.js`, `reset-password.js`, `tests/unit/request-password-reset.test.js`, `tests/unit/reset-password.test.js`.

## Commits (work units, conventional, English)

PR 1:
1. `165960a` feat(db): add email and reset token schema (migration 003)
2. `37a6c07` feat(config): require CLIENT_URL and expose reset token settings
3. `70e59e0` feat(auth): add email to user entity and repository (+ repo tests)
4. `6aa9e4f` feat(auth): require unique email on registration (+ unit/integration tests)
5. `660efb7` fix(auth): forward email through the register route

PR 2 (branch `feat/recuperar-contrasena-02-domain`):
6. `7154240` feat(auth): add reset token entity, repository and mailer ports
7. `96b152e` feat(auth): request password reset issues hashed single-use tokens
8. `db55d3f` feat(auth): reset password marks token used then replaces hash

PR 3 (branch `feat/recuperar-contrasena-03-wiring`):
9. `d124ef5` feat(auth): add pg reset token repository with atomic cap enforcement
10. `fe3f917` feat(auth): add console mailer for reset links
11. `4e19b38` feat(auth): wire forgot/reset password endpoints end-to-end

Phase 4 (this batch, tracker branch `feat/recuperar-contrasena`):
12. `3d81993` test(auth): cover pre-reset JWT validity after password reset

Untracked `pnpm-workspace.yaml` left uncommitted (unrelated to this change). `openspec/` and `.env.test` are gitignored by design.

## Deviations from Design

- **PR 3 (design defect, empirically verified)**: the design's cap SQL (D4, "Non-obvious SQL" block) inserts first, then computes `overflow` with `OFFSET $4` in a later CTE. PostgreSQL WITH sub-statements share the command snapshot, so the overflow scan cannot see the just-inserted row — verified against the live `saludback_test` DB: after issuing the 4th token with cap 3, 4 tokens remained outstanding and nothing was marked used; the statement also returned no inserted row (main SELECT could not see the insert either). **Fix**: mark-first ordering — the `overflow` CTE (`OFFSET $4 - 1`, marking the oldest beyond the newest cap−1) runs before the INSERT, which is the main statement with `RETURNING`. Empirically correct: h1 marked used, exactly 3 outstanding, inserted row returned. Parameter layout preserved from the design (`$1` user, `$2` hash, `$3` expiry, `$4` cap). Everything else matches design.
- PR 1 carried one design gap (not a deviation): `auth.routes.js` `/register` had to forward `email` once the use case required it; one-line fix, documented in the PR 1 apply-progress.
- Phase 4: none — the D7 test addition implements the design's stated behavior (stateless JWTs stay valid); no design change.

## Issues Found

- **D7 spec gap (Phase 4, closed)**: the fresh review found the password-recovery scenario "Pre-reset token still valid" had NO covering test. Closed by adding the integration test (register → login → forgot → reset → pre-reset JWT still accepted on a protected route) — the recommended option; no waiver. Committed as `3d81993`. Suite went 99/99 → 100/100.
- PR 3 changed-line count is 450 (50 over the nominal 400 budget) — 446 insertions / 4 deletions across 7 files; the 4 deletions are the route doc comment rewrite. All tests ship with the behavior they verify (work-unit-commits). Flagged for the orchestrator.
- Design SQL defect (see Deviations) — corrected in implementation; no functional impact on the acceptance criteria; the integration cap test proves the corrected behavior end-to-end.
- None other outstanding.

## Next Steps

- All 24 tasks complete (1.1–4.2). Ready for `sdd-verify`.
- Orchestrator: fresh-context review of the tracker branch `feat/recuperar-contrasena` (all slices merged, local tip `3d81993` with the Phase 4 test commit; remote synced at `3cf3ac3`), then run verify; tracker PR #8 and final merge after verify.
