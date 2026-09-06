# Archive Report — recuperar-contrasena

**Change**: recuperar-contrasena — Self-service password recovery (recuperar contraseña)
**Archived**: 2026-08-15
**Archive path**: `openspec/changes/archive/2026-08-15-recuperar-contrasena/`
**Verdict at archive time**: PASS WITH WARNINGS (verify-report, no CRITICAL issues) — READY TO ARCHIVE
**Commit verified**: tracker branch `feat/recuperar-contrasena` @ `3d81993` (PR 1 `660efb7`, PR 2 `db55d3f`, PR 3 `4e19b38`, Phase 4 `3d81993`; remote synced at `3cf3ac3`)

## Change Summary

Self-service email-link password reset in the auth module's Clean Architecture idiom: `POST /auth/forgot-password` issues a single-use, expiring reset token (stored at rest only as a `sha256` hash) and delivers the link through a new `MailerPort` seam (console/dev transport this slice; SMTP is a non-goal); `POST /auth/reset-password` verifies the hash/expiry/usage, marks the token used, and replaces the bcrypt hash (cost 12). Anti-enumeration is preserved: every forgot-password outcome returns the identical generic 200 body. The change also adds `users.email` (nullable, unique, no backfill — no users↔patients join key exists) and makes email required for new registrations.

Scope delivered: additive migration `003` (`users.email` + `password_reset_tokens`), `MailerPort` + `ConsoleMailer`, `ResetTokenRepositoryPort` + PG adapter with atomic outstanding-token cap enforcement (mark-first ordering — a verified fix of a design SQL defect), `UserRepositoryPort.findByEmail`/`updatePassword`, use cases `RequestPasswordReset` and `ResetPassword`, two unguarded routes (login precedent), config (`CLIENT_URL` required at boot; `RESET_TOKEN_TTL` default 15; `RESET_TOKEN_MAX_OUTSTANDING` default 3), and unit + integration suites. Out of scope (by decision): SMTP/Nodemailer delivery, rate limiting, frontend, admin-mediated reset, legacy backfill.

Satisfies two new capabilities, both materialized in this archive: `password-recovery` (10 scenarios, 7 requirements) and `user-accounts` (7 scenarios, 5 requirements).

## Delivery Record

Delivered as 3 chained PR slices + Phase 4 verification commit (review-workload guard: ~700–800 line forecast, 400-line budget risk High, chain strategy applied). All slices merged to the tracker branch; the orchestrator owns the tracker PR and final merge to `main`.

| Slice | Branch | Merge/tip | Content |
|-------|--------|-----------|---------|
| PR 1 — Foundation | `feat/recuperar-contrasena-01-foundation` | `660efb7` | Migration 003, config/env (`CLIENT_URL`, TTL, cap), `users.email` on entity/repository/register (required + 409 on duplicate), tests. 299 changed lines (264+/35−) |
| PR 2 — Reset domain/application | `feat/recuperar-contrasena-02-domain` | `db55d3f` | `PasswordResetToken` entity, `ResetTokenRepositoryPort` + `MailerPort`, both use cases + unit suites. 401 changed lines (401+/0−) |
| PR 3 — Persistence, wiring, e2e | `feat/recuperar-contrasena-03-wiring` | `4e19b38` | `PgResetTokenRepository` (atomic cap), `ConsoleMailer`, routes + `src/index.js` wiring, repo/mailer unit tests, 6 integration tests. 450 changed lines (446+/4−) |
| Phase 4 — Final verification | tracker `feat/recuperar-contrasena` | `3d81993` | `pnpm test` + `pnpm db:migrate` green (003 applied to dev + test DBs), full spec-to-test trace, D7 gap closed (+1 integration test). 31 insertions |

12 work-unit commits in total, conventional, English, no AI attribution (`git log` bodies empty). Untracked `pnpm-workspace.yaml` left uncommitted (unrelated). `openspec/` and `.env.test` are gitignored by design — no archive commit performed.

## Verify Verdict

**PASS WITH WARNINGS** (archive-ready) — 2026-08-15, independent fresh-context verification of `feat/recuperar-contrasena` @ `3d81993`.

- Tasks: 24/24 complete (`tasks.md` all `[x]`; task completion gate passed before archive).
- Tests: 100 passed / 0 failed / 0 skipped on real PostgreSQL (`.env.test`), including all 17 auth integration tests and 5 new unit suites; independently re-run by the verifier.
- Spec compliance: 17/17 scenarios COMPLIANT (10 password-recovery + 7 user-accounts) with passing covering tests; 0 UNTESTED, 0 FAILING, 0 PARTIAL. Includes the previously-gapped D7 scenario (pre-reset JWT stays valid) closed in Phase 4 and re-verified.
- Design coherence: D1–D10 followed. Two deviations verified CORRECT and kept: (a) `/register` route forwards `email` (design.md documentation gap, fixed correctly by implementation); (b) cap SQL mark-first ordering (fixes a real design defect — PostgreSQL WITH sub-statements share the command snapshot, so the design's insert-first CTE could never see the inserted row; proven end-to-end against the live test DB).
- Build: N/A (plain ESM, no build step). Coverage: not configured (no tooling; threshold unset).

## Known Warnings / Suggestions Carried Forward

**WARNING (accepted, recorded)**
1. PR 3 was 450 changed lines (446+/4−) vs the nominal 400-line review budget — all-insertion (adapter + mailer + routes + 7 tests); flagged to the orchestrator in the apply batch and accepted there. Does not affect archive readiness.

**SUGGESTIONS (optional, non-blocking — candidates for a future hygiene change)**
1. Cap scan counts expired-but-unused tokens: `PgResetTokenRepository.create`'s overflow scan filters only `used_at IS NULL`; adding `expires_at > now()` would match the spec letter ("outstanding unexpired tokens capped"). Security property holds regardless (live unexpired tokens ≤ cap always).
2. Whitespace-only `newPassword` passes `reset-password` validation (`!newPassword` doesn't trim) — consistent with register/login precedent; optional uniformity improvement.
3. Reset is two statements without a transaction (`markUsed` + `updatePassword`); a crash between them forces a re-request (design D8 tradeoff). A transaction boundary would require a port/interface change — out of scope.
4. Baseline spec overlap: `user-registration` (register: username+password) and `user-accounts` (register: username+password+email) both describe `POST /auth/register`; the email requirement now lives only in `user-accounts`. Reconcile in a future spec hygiene pass.
5. Proposal success-criteria checkboxes were never ticked (cosmetic — all four criteria are demonstrated met in verify-report); design.md open questions (timing side-channel, config.yaml refresh, SMTP/CLIENT_URL values) remain open by decision. Noted for audit transparency; `tasks.md` itself is 24/24 complete.

## Spec Sync Note

Neither capability spec existed in the baseline before this change, so both full delta specs were **copied** to `openspec/specs/` during archive (main-spec-does-not-exist path — the delta IS a full spec):

- `openspec/changes/.../specs/password-recovery/spec.md` → `openspec/specs/password-recovery/spec.md`
- `openspec/changes/.../specs/user-accounts/spec.md` → `openspec/specs/user-accounts/spec.md`

Identity verified: byte-for-byte identical to the archived change specs (case-sensitive hash compare). This follows the pacientes precedent, where the baseline spec is the source of truth (`patient-registration` was already materialized at archive time and only identity-verified); here the sync step itself was required because the copies did not exist. Main specs now reflect the new behavior for both capabilities.

## Archive Contents

- `proposal.md` — intent, agreed decisions, scope, approach, rollback plan, success criteria
- `exploration.md` — optional sdd-explore artifact (current-state analysis, approaches, recommendation)
- `specs/password-recovery/spec.md` — delta spec (7 requirements, 10 scenarios)
- `specs/user-accounts/spec.md` — delta spec (5 requirements, 7 scenarios)
- `design.md` — architecture decisions D1–D10, data flow, file changes, interfaces, testing strategy
- `tasks.md` — 24/24 tasks complete (1.1–4.2)
- `apply-progress.md` — batch-by-batch completion evidence (PR 1–3 + Phase 4), spec-to-test trace, deviations
- `verify-report.md` — PASS WITH WARNINGS with compliance matrix (17/17) and verdict
- `archive-report.md` — this report

No unchecked implementation tasks in the archived `tasks.md`. Active `openspec/changes/` no longer contains the change.

## Next Steps

None pending — the SDD cycle is closed for this change. Orchestrator: open/merge the tracker PR (`feat/recuperar-contrasena`) into `main` when ready.

Future work (tracked, not blocking):
- Real SMTP delivery behind the `MailerPort` (new adapter + wiring only) and real `CLIENT_URL` value.
- Rate limiting for the reset endpoints (token guessing, mail-bombing).
- Spec-letter cleanup on the cap scan (`expires_at > now()`); optional.
- Token-version invalidation (`ver` claim in `authenticate`) documented as the future direction for D7.

## skill_resolution

paths-injected — `sdd-archive` SKILL.md plus shared references (`_shared/sdd-phase-common.md`, `_shared/openspec-convention.md`) loaded as provided by the orchestrator.
