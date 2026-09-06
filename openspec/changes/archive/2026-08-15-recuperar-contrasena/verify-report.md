# Verification Report — recuperar-contrasena

**Change**: recuperar-contrasena
**Version**: delta specs `password-recovery` (v1) + `user-accounts` (v1), created for this change
**Mode**: Standard (strict_tdd: false)
**Date**: 2026-08-15
**Verifier**: independent, fresh-context (sdd-verify executor)
**Branch verified**: `feat/recuperar-contrasena` @ `3d81993` (all slices merged: PR 1 `660efb7`, PR 2 `db55d3f`, PR 3 `4e19b38`, Phase 4 `3d81993`)

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 24 |
| Tasks complete | 24 (1.1–4.2, all `[x]`) |
| Tasks incomplete | 0 |

`tasks.md` checkboxes verified by inspection; `apply-progress.md` is cumulative across all batches (PR 1 + PR 2 + PR 3 + Phase 4) and coherent with `git log` (12 work-unit commits present on the tracker branch).

## Build & Tests Execution

**Pretest (migration hook)**: ✅ Passed — `Skipping 001_create_users.sql (already applied)`, `Skipping 002_create_patients.sql (already applied)`, `Skipping 003_add_email_and_reset_tokens.sql (already applied)` — migration 003 confirmed applied to `saludback_test`.

**Tests** (`pnpm test` = `node --env-file=.env.test --test`): ✅ **100 passed / 0 failed / 0 skipped**
```text
ℹ tests 100
ℹ suites 0
ℹ pass 100
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11945.2739
```
All 17 auth-related integration tests and all 5 new unit suites passed in this run (full list in `apply-progress.md` §4.1; command output re-run independently above).

**Build**: N/A — plain ESM Node app, no build step. **Coverage**: ➖ Not configured (no coverage tooling in `package.json`; `verify.coverage_threshold` not set in config).

## Spec Compliance Matrix (independent trace)

Every scenario below was traced to a test that **passed in my own run of `pnpm test`** (not inferred from prior reviews). Where the apply-progress trace is referenced, it was confirmed against the actual code and test names.

### password-recovery spec — 10 scenarios, 10 COMPLIANT

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| Forgot-password — User with email | unit `tests/unit/request-password-reset.test.js` > `user with email gets a token and a mailed link; body is the generic success` (token created via repo, `sendMail` called with recipient); integration `tests/integration/auth.test.js` > `POST /auth/forgot-password mails a reset link to a user with email` (200, generic body, link `startsWith(clientUrl + '?token=')`) | ✅ COMPLIANT |
| Forgot-password — Unknown username | unit > `unknown username returns identical body with no token and no mail` (no create, no mail); integration > `POST /auth/forgot-password is identical for unknown and email-less users and mails nothing` | ✅ COMPLIANT |
| Forgot-password — User without email | unit > `user without email returns identical body with no token and no mail`; integration > same combined test (direct `email = NULL` insert proves nullable column + fold-in) | ✅ COMPLIANT |
| Forgot-password — identical body across outcomes | unit > `identical body across all three outcomes` (deepEqual across with-email / unknown / email-less) | ✅ COMPLIANT |
| Reset token lifecycle — Hash at rest | unit > `hash at rest: the stored token hash is the sha256 of the raw token in the mailed link` (asserts stored hash === sha256(raw) and !== raw); migration inspection: `token_hash TEXT NOT NULL UNIQUE`, no raw-token column | ✅ COMPLIANT |
| Reset token lifecycle — Per-user cap enforced | unit `tests/unit/pg-reset-token-repository.test.js` > `create runs the atomic cap+insert statement with user, token and cap params` (asserts `OFFSET $4 - 1`, `used_at IS NULL`, `ORDER BY created_at DESC, id DESC`, params `[userId, hash, expiry, 3]`); integration > `issuing beyond the outstanding cap invalidates the oldest token` (cap+1 issued → exactly cap outstanding on the real DB, oldest marked used) | ✅ COMPLIANT |
| Reset token lifecycle — TTL default 15 min | unit > `issued token carries the userId and an expiring expiresAt` (expiresAt ≈ now + 15 min); `src/config.js` default `resetTokenTtl = 15` | ✅ COMPLIANT |
| Reset link target — Link shape | unit > `link shape is {clientUrl}?token=<raw 32-byte token>` (64-hex raw); integration > `POST /auth/forgot-password mails a reset link…` (asserts `text.startsWith(config.clientUrl + '?token=')`); no reset page hosted (routes are JSON-only) | ✅ COMPLIANT |
| Reset link target — `CLIENT_URL` required, boot fails without it | `src/config.js`: `CLIENT_URL` in `REQUIRED_ENV`, `missingRequired()` throws at import. No dedicated test — **by construction**, consistent with existing `DATABASE_URL`/`JWT_SECRET` handling (also untested). | ✅ COMPLIANT (by construction) |
| Reset password — Valid reset | unit > `valid token: looks up by sha256, marks used, then replaces the password hash`; unit > `markUsed runs before updatePassword (design D8)`; integration > `forgot then reset: old password stops working, new one works, token is single-use` (200, old login 401, new login 200, reuse 400); bcrypt cost 12 via `BcryptHasher(config.bcryptCost)` (same hasher as register; unit `cost factor is honored` passes) | ✅ COMPLIANT |
| Reset password — Invalid token | unit > `unknown, used, or expired token throws one generic error and never touches the password` (one `BadRequestError('Invalid or expired reset token')`, no markUsed/updatePassword); integration > `an expired reset token is rejected with the password unchanged` (old login still 200); integration > reuse → 400 generic in the e2e test; missing/empty token+newPassword → 400 (unit + integration `POST /auth/reset-password rejects missing or empty fields with 400`) | ✅ COMPLIANT |
| Mailer port seam — Delivery through the port | unit > `user with email gets a token and a mailed link…` (asserts `sendMail` called with recipient + link); unit `tests/unit/console-mailer.test.js` > `sendMail prints recipient, subject and the reset link to stdout`; swapping transports = wiring-only (SMTP non-goal: no nodemailer/express-rate-limit in `package.json`) | ✅ COMPLIANT |
| Existing sessions unaffected — Pre-reset token still valid | integration > `a pre-reset access token stays valid on protected routes after the password reset` (register → login → forgot → reset → pre-reset JWT accepted on `/secure` route, 200). **This was the D7 gap closed in Phase 4 (`3d81993`); passed in this run.** | ✅ COMPLIANT |

### user-accounts spec — 7 scenarios, 7 COMPLIANT

| Scenario | Test evidence (passed this run) | Result |
|----------|--------------------------------|--------|
| Email required — Successful registration with email | unit > `successful registration creates an estudiante with a hashed password and email`; integration > `POST /auth/register creates an estudiante with a bcrypt hash and email` (201, email persisted in `users`, `passwordHash` never in body) | ✅ COMPLIANT |
| Email required — Missing or malformed email | unit > `missing, empty or malformed email throws BadRequestError` (create never called); integration > `POST /auth/register rejects missing or empty fields with 400` (payloads include missing email + `not-an-email` → 400 `BAD_REQUEST`) | ✅ COMPLIANT |
| Email required — Duplicate email | unit > `duplicate email throws ConflictError and does not create`; integration > `POST /auth/register rejects a duplicate email with 409` (409, no second row) | ✅ COMPLIANT |
| Legacy users keep NULL email — Existing rows untouched | Migration `003_add_email_and_reset_tokens.sql` is purely additive: `ALTER TABLE users ADD COLUMN email TEXT` (nullable), unique index (PG allows multiple NULLs), no backfill — by inspection; integration > `POST /auth/forgot-password is identical for unknown and email-less users…` proves a post-migration row with `email = NULL` persists and behaves | ✅ COMPLIANT |
| Recovery denied without email | unit > `user without email returns identical body with no token and no mail`; integration > combined test (identical body, zero mails) — no leak | ✅ COMPLIANT |
| User lookup/update — Find by email | unit > `findByEmail returns null when no user matches` + `findByEmail maps a database row to a User` (`WHERE email = $1`) | ✅ COMPLIANT |
| User lookup/update — Password replaced | unit > `updatePassword replaces the hash for the given user id` (`UPDATE users SET password_hash = $2 WHERE id = $1`); integration > e2e forgot→reset: old password 401, new password 200 | ✅ COMPLIANT |

**Compliance summary**: **17/17 scenarios COMPLIANT** (10 password-recovery + 7 user-accounts). 0 UNTESTED, 0 FAILING, 0 PARTIAL. This independently confirms the apply-progress trace (which listed the same 17 scenarios, 16 covered pre-Phase-4 + D7 closed this batch).

## Correctness (Static Evidence)

| Area | Status | Notes |
|------|--------|-------|
| Migration 003 | ✅ Implemented | Additive: `users.email` nullable + unique index; `password_reset_tokens` (`token_hash UNIQUE`, `used_at`, `expires_at`, FK CASCADE, index on user_id); no backfill. Applied to test DB (pretest hook) and dev DB (apply phase `pnpm db:migrate`). |
| Config | ✅ Implemented | `CLIENT_URL` in `REQUIRED_ENV` (boot fail); `clientUrl`, `resetTokenTtl` (15), `resetTokenMaxOutstanding` (3) env-with-default; injected via constructors — grep confirms **no `process.env` / `loadEnvFile` anywhere in `src/modules/auth/application/`** (D9). |
| Domain entities | ✅ Implemented | `User.email` (default null); `PasswordResetToken` (`id, userId, tokenHash, expiresAt, usedAt, createdAt`) matching design. |
| Ports | ✅ Implemented | `UserRepositoryPort.findByEmail`/`updatePassword`; `ResetTokenRepositoryPort` (create cap-enforced / findValidByHash / markUsed); `MailerPort.sendMail`. |
| Use cases | ✅ Implemented | `RequestPasswordReset` (generic body D6, sha256 at rest D3, `{clientUrl}?token=` link, no mail for unknown/NULL-email); `ResetPassword` (sha256 lookup, generic 400 D5, mark-then-update D8). |
| Register | ✅ Implemented | Email required (400), regex `^[^@\s]+@[^@\s]+$` (D10), duplicate → 409, email persisted; route forwards `email` (fix `660efb7`). |
| PG adapters | ✅ Implemented | `PgUserRepository` (email in CRUD, `findByEmail`, `updatePassword`); `PgResetTokenRepository` (atomic cap SQL, `findValidByHash` = `used_at IS NULL AND expires_at > now()`, `markUsed`). |
| Mailer | ✅ Implemented | `ConsoleMailer` prints `To:` / `Subject:` / link to stdout. |
| Routes / wiring | ✅ Implemented | Unguarded `POST /forgot-password` + `POST /reset-password`; `index.js` wires `PgResetTokenRepository(pool, cap)`, `ConsoleMailer`, passes TTL/cap/clientUrl. |

## Coherence (Design D1–D10)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 Mailer seam | ✅ Yes | `MailerPort` + `ConsoleMailer`; SMTP later = new adapter + wiring only. |
| D2 `users.email` nullable + unique | ✅ Yes | `ADD COLUMN email TEXT` + `users_email_unique`; no backfill; legacy NULL preserved. |
| D3 Token at rest = sha256 | ✅ Yes | `token_hash` sha256 of raw 32-byte token; raw only in mailed link. |
| D4 Single-use + atomic cap | ✅ Yes | `used_at` single concept; cap enforced in one statement (see deviation (b)). |
| D5 Generic 400 for invalid token | ✅ Yes | `findValidByHash` null → `BadRequestError('Invalid or expired reset token')`. |
| D6 Generic forgot-password body | ✅ Yes | One 200 body on every non-400 path; unknown/NULL-email fold into no-mail. |
| D7 Sessions unaffected | ✅ Yes | Stateless JWT, no invalidation; **now covered by integration test** (`3d81993`); `ver` claim documented as future. |
| D8 Mark-then-update | ✅ Yes | `markUsed` before `updatePassword`; unit test asserts call order. |
| D9 Config injected, no env in use cases | ✅ Yes | Verified by grep (no env access in application layer). |
| D10 Email validation + 409 | ✅ Yes | Reused regex; use-case check + DB unique index. |

### Known deviations — verified and judged

- **(a) `auth.routes.js` `/register` forwards `email`** (`660efb7`). `design.md`'s File Changes table omitted this line, but the register-user use case requires `email` — without the forward, registration would 400. This is a **design.md documentation gap, fixed correctly by the implementation**; spec-compliant (email persisted, 201). Judgment: **CORRECT, keep**.
- **(b) Cap SQL: mark-first ordering in `PgResetTokenRepository.create`** instead of the design's insert-first CTE. Design defect confirmed by analysis: PostgreSQL WITH sub-statements share the command snapshot, so the design's `overflow` scan (`OFFSET $4` computed after the insert CTE) can never see the just-inserted row — with cap 3 and 3 outstanding, it selects 0 rows, marks nothing, and 4 tokens end up outstanding. Implementation reorders: `overflow` (pre-insert scan, `OFFSET $4 - 1` = keep newest cap−1 existing) → `marked` (UPDATE) → main `INSERT … RETURNING`. Traced semantics: at cap (3 outstanding) the 4th issuance marks exactly the oldest used and returns 3 outstanding; below cap nothing is invalidated; the new token is always the newest so kept-set = newest cap−1 existing + new = cap. **Empirically verified against the live `saludback_test` DB in this run**: integration test `issuing beyond the outstanding cap invalidates the oldest token` passed (cap+1 = 4 rows, exactly 3 unused, oldest used). Parameter layout preserved (`$1` user, `$2` hash, `$3` expiry, `$4` cap). Judgment: **CORRECT, keep** — the implementation fixes a design defect; no acceptance-criteria impact.
- Phase 4 D7 test addition: implements the design's stated behavior; no design change.

## Rollback / Non-goals Check

| Check | Result |
|-------|--------|
| `pnpm-workspace.yaml` untracked | ✅ `git status` shows `?? pnpm-workspace.yaml` — uncommitted, unrelated. |
| No SMTP transport | ✅ No nodemailer in `package.json`; only `bcryptjs`, `express`, `jsonwebtoken`, `pg` (pre-existing). |
| No rate limiting | ✅ No `express-rate-limit` or equivalent. |
| No frontend / no reset page | ✅ API-only; link target is `CLIENT_URL`. |
| No admin-mediated reset / no backfill tooling | ✅ Not present. |
| Migration additive & harmless | ✅ `003` additive; rollback = redeploy previous build (forward-only runner). |
| No other scope creep | ✅ Diff limited to auth module + config + env + tests. |

## Work-Unit / Commit Quality

| Check | Result |
|-------|--------|
| Conventional commits, English | ✅ 12 commits: `feat(db)` `feat(config)` `feat(auth)` `fix(auth)` `test(auth)` — English, descriptive of outcome. |
| No AI attribution | ✅ `git log --format=%b` bodies of the 12 change commits are empty; no `Co-Authored-By` anywhere. |
| Tests travel with code | ✅ Each work-unit commit bundles its tests (e.g. `feat(auth): require unique email on registration (+ unit/integration tests)`); unit suites sit alongside the behavior commits, integration in the wiring commit. |
| Work-unit story | ✅ 3 chained-PR slices (foundation → domain/application → persistence/wiring/e2e) + Phase 4 verification commit — coherent reviewable units per `work-unit-commits`. |
| Chain hygiene | ✅ PR 1/2/3 merged to tracker; tracker diff clean (only the slice under review per PR); Phase 4 commit `3d81993` sits on the tracker on top of the synced remote `3cf3ac3`. |

## Issues Found

**CRITICAL**: None.

**WARNING**:
1. **PR 3 review budget overshoot (documented, accepted)**: PR 3 was 450 changed lines (446+/4−) vs the 400-line budget — all-insertion (repo adapter + mailer + routes + 7 tests), flagged to the orchestrator in the apply batch and accepted there. Does not affect archive readiness; recorded for the audit trail.

**SUGGESTION**:
1. **Cap scan counts expired-but-unused tokens**: `PgResetTokenRepository.create`'s overflow scan filters only `used_at IS NULL`, so tokens that expired without being used still occupy a cap slot until pushed out by newer issuances. This matches design D4 exactly (design SQL has the same filter) and the security property holds (live unexpired tokens ≤ cap always), but the spec text says "outstanding *unexpired* tokens … capped" — adding `expires_at > now()` to the overflow scan would match the letter of the spec. Optional cleanup.
2. **Whitespace-only `newPassword` accepted by reset-password**: `if (!newPassword)` doesn't trim, so `'   '` passes validation. Consistent with the register/login precedent (`!password`), and no spec scenario demands trimming — optional uniformity improvement.
3. **Reset is two statements without a transaction**: `markUsed` + `updatePassword` are separate queries; a crash between them forces a re-request (D8 tradeoff, documented in design). A transaction boundary would make reset atomic — real improvement, but requires a port/interface change and is out of scope for this change.

## Verdict

**PASS WITH WARNINGS — READY TO ARCHIVE**

- 24/24 tasks complete; `pnpm test` 100/100 (verified in an independent run).
- 17/17 spec scenarios COMPLIANT with passing covering tests, including the previously-gapped D7 scenario (closed in Phase 4, re-verified here).
- All design decisions D1–D10 followed; both known deviations (register email forward; cap SQL mark-first ordering) verified **CORRECT** — the latter is a genuine fix of a design defect, proven end-to-end against the real test DB.
- No CRITICAL issues. One accepted process WARNING (PR 3 line budget) and three optional SUGGESTIONS.
