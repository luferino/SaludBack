# Proposal: Password recovery (recuperar contraseña)

## Intent

Users cannot recover a forgotten password: `users` has no email, there is no mailer, no password-update use case, no reset endpoints. Ship a self-service email-link reset flow in the repo's Clean Architecture idiom.

## Agreed Decisions

- `MailerPort` seam + console/dev transport this slice; SMTP later (non-goal).
- `users.email` required for new registrations; nullable for legacy rows; recovery denied when absent.
- Email link + single-use expiring token, stored as `sha256` hash in a new table.
- `CLIENT_URL` env for link target; API-only (no frontend in this workspace).
- Anti-enumeration: `forgot-password` returns one generic response for any identifier (login's generic-401 precedent).

## Scope

**In:** migration `003` (`users.email` nullable + `password_reset_tokens`); `MailerPort` + `ConsoleMailer` + reset-token store + `UserRepositoryPort.updatePassword`/`findByEmail`; use cases `request-password-reset` & `reset-password`; routes `POST /auth/forgot-password` & `POST /auth/reset-password`; config `CLIENT_URL`, `RESET_TOKEN_TTL`; unit + integration tests.
**Out:** SMTP/Nodemailer delivery; rate limiting; frontend; admin-mediated reset; legacy backfill tooling.

## Capabilities

No specs exist in `openspec/specs/` — both are new:
- `user-accounts`: email on users, `updatePassword`, deny-recovery-without-email rule.
- `password-recovery`: forgot/reset flow, token lifecycle, mailer seam, anti-enumeration.

## Approach

Approach 1 (exploration): `forgot-password` always returns the same generic success; when the email exists it creates an expiring random token (`sha256` at rest) and mails `CLIENT_URL?token=…`; `reset-password` verifies hash/expiry/unused, invalidates, writes a new bcrypt hash (cost 12). Mirrors auth patterns: entity, ports, pg repository, routes factory.
**Backfill note:** no join key links `users` ↔ `patients` (`patients.created_by` is null today and records the creating admin, not the patient's login), so backfill from `patients.email` is not schema-supported; legacy users keep NULL email and are denied recovery until updated.

## Affected Areas

| Area | Impact |
|---|---|
| `src/db/migrations/003_*.sql` | New |
| `src/modules/auth/domain/` | Modified/New |
| `src/modules/auth/application/` | Modified/New |
| `src/modules/auth/infrastructure/` | Modified/New |
| `src/index.js`, `src/config.js`, `.env.example`, `.env.test` | Modified |
| `tests/unit/`, `tests/integration/` | New |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Console mailer reaches prod | Med | Seam + explicit non-goal; SMTP tracked as dependency |
| Enumeration via differing responses | Med | Identical generic response on every branch |
| Token guessing/replay | Med | sha256 at rest, short TTL, single-use |
| Legacy users unrecoverable | High (fact) | Deny recovery without email; documented |

## Rollback Plan

Redeploy previous build — new endpoints idle, additive table/column harmless, env vars removed. Runner is forward-only: no down migration.

## Dependencies

- `CLIENT_URL` + `RESET_TOKEN_TTL` values at deploy; real SMTP credentials (deferred deliverable).

## Success Criteria

- [ ] End-to-end reset works via console-transport link (integration test)
- [ ] Identical `forgot-password` response for existing/missing email
- [ ] Token single-use; expired rejected; hash-only at rest
- [ ] Recovery denied without email; registration rejects missing email

## Size Forecast

~700 changed lines (range 500–900). Chained-PR likelihood: **High** — 3 slices (migration+config → domain/application → routes/mailer/wiring+tests).

## Open Questions

- Rate limiting appetite: minimal outstanding-token cap (no new dep) vs `express-rate-limit` (new dep) — confirm at specs.
- Actual `CLIENT_URL` value; SMTP provider/timing (deferred by decision).
- Refresh stale `openspec/config.yaml` (scaffold-era facts) — small hygiene task.
