# Exploration: Password recovery (recuperar contraseña)

## Current State

SaludBack is a Node.js 24 / Express 5 / PostgreSQL backend with modular Clean
Architecture: `src/modules/<module>/{domain,application,infrastructure}` plus
`shared` for cross-cutting code (errors, guard). Two modules are implemented —
`auth` and `pacientes` — and the repo is on `main` with conventional commits
and chained PRs (auth #1–3, pacientes #4–6). Single package, not a monorepo:
`pnpm-workspace.yaml` contains only `minimumReleaseAge: 2880`, no `packages` —
it is NOT a workspace file.

### Auth flow today

- **Login** (`src/modules/auth/application/login-user.js`): `findByUsername` →
  `hasher.compare` (bcryptjs, cost 12) → sign JWT with
  `{ sub, username, role, permissions, iat, exp, iss: 'SaludBack', aud: 'SaludBack-api' }`.
  Unknown username and wrong password throw the **same generic 401**
  (anti-enumeration, verified by integration test comparing both bodies).
- **Register** (`register-user.js`): admin-originated alta of `estudiante`
  accounts; validate → `findByUsername` (dup → 409) → hash → create. Runs
  behind the guard seam (`OpenGuard` today; login bypasses the guard).
- **Token service** (`infrastructure/services/jwt-token-service.js`):
  `jsonwebtoken`, `JWT_SECRET` from env, `JWT_EXPIRES_IN` default `2h`. No
  refresh rotation (explicitly deferred in the auth design).
- **authenticate middleware** exists (Bearer → verify → `req.auth =
  { role, permissions }`) but is **not wired to any route** yet.
- **Password storage**: `users` table stores only the bcrypt hash.

### Critical gaps for password recovery

1. **No email on users.** `001_create_users.sql`:
   `users(id UUID PK DEFAULT gen_random_uuid(), username TEXT NOT NULL UNIQUE,
   password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TIMESTAMPTZ)`.
   The `patients` table has an `email` column, but patients are not users —
   there is no link between them and no email anywhere in the auth domain.
   **Recovery by email is impossible today without a migration adding an
   `email` column (plus a backfill strategy for existing rows).**
2. **No mailer.** Grep for `nodemailer|smtp|sendMail|mailer|transporter|EMAIL_*`
   across the repo finds nothing. No SMTP config, no mail env vars, no mail
   dependency in `package.json` (deps: `bcryptjs`, `express`, `jsonwebtoken`,
   `pg` only). Any email-delivered reset needs either a new dependency +
   SMTP credentials, or a delivery seam with a dev transport (e.g. log to
   console) mirroring the `OpenGuard` seam pattern.
3. **No rate limiting.** No `express-rate-limit` or any throttle/limit code.
   Reset endpoints are high-value abuse targets (token guessing, mail-bombing,
   user enumeration) — a protection strategy must be chosen.
4. **No password-change capability.** No use case, repository method, or
   endpoint exists to update a password hash. The `UserRepositoryPort` exposes
   only `findByUsername` and `create`.

### Existing patterns to follow (from `auth` and `pacientes`)

- **Structure**: entity in `domain/` (plain class, `static create`,
  `toJSON()` that hides secrets); use cases in `application/` (validate →
  throw `BadRequestError` on missing fields → call injected ports); ports as
  abstract classes with throwing stubs in `application/ports.js`; pg
  repository in `infrastructure/repositories/` (snake_case→camelCase
  `rowToX` mapper, `COLUMNS` constant); routes factory
  (`createAuthRouter({ repository, hasher, tokenService, guard = new
  OpenGuard() })`) where each handler calls `guard.authorize(req)` first.
- **Wiring**: `src/index.js` — one `pg.Pool` from `config.databaseUrl`, ports
  instantiated at boot, `app.use('/auth', ...)`, `errorHandler` last.
- **Errors**: `shared/domain/errors.js` — `AppError(statusCode, code)` +
  `BadRequestError` (400), `ConflictError` (409), `UnauthorizedError` (401).
  `middleware/error-handler.js` maps AppError → `{ error: { code, message } }`.
  A new `NotFoundError`-style case may be needed (or reuse 400/401 generic
  responses to avoid enumeration — see Risks).
- **Config**: `src/config.js` — fail-fast on `REQUIRED_ENV`, frozen export,
  native `process.loadEnvFile()` (no dotenv). New env vars for mail/SMTP or
  reset TTL slot in here.
- **Migrations**: custom runner `src/db/migrate.js` — sorted `*.sql` files in
  `src/db/migrations/`, per-file transactions, recorded in
  `schema_migrations`, forward-only (**no rollback**). New migration must be
  purely additive. `pretest` auto-migrates `saludback_test`.
- **Tests**: `node:test` + `assert/strict`. Unit tests inject fakes (fake
  pool `{ query }`, fake hasher/token) and assert error classes. Integration
  tests (`tests/integration/auth.test.js`, `patients.test.js`) build a real
  express app with the real router + `errorHandler`, real `pg.Pool` against
  `config.databaseUrl` (`.env.test` → `saludback_test`), ephemeral port +
  `fetch`; `before` cleans tables, `after` closes. Scripts:
  `"test": "node --env-file=.env.test --test"`, `"pretest"` migrates.
- **Git history size**: auth shipped ~1100 lines across 3 chained PRs; the
  recovery change (migration + entity + 2-3 use cases + mailer seam + routes +
  config + tests) plausibly lands 500–900 lines → tasks phase must forecast
  PR chaining.

## Affected Areas

- `src/db/migrations/003_*.sql` — new additive migration(s): `email` on
  `users` (nullable or backfilled) and a reset-token table
  (`id`, `user_id`, `token_hash`, `expires_at`, `used_at`, …).
- `src/modules/auth/domain/` — `user.js` gains `email`; new
  `password-reset-token.js` entity if the DB-table approach is chosen.
- `src/modules/auth/application/` — new use cases
  (`request-password-reset.js`, `reset-password.js`) + port additions
  (`updatePassword` on `UserRepositoryPort`; `MailerPort`; token-store port).
- `src/modules/auth/infrastructure/` — routes factory additions
  (`POST /auth/forgot-password`, `POST /auth/reset-password`), pg repository
  methods, mailer implementations (console dev transport + optional SMTP),
  token generator/expiry.
- `src/index.js` — wire new ports + mailer into the auth router.
- `src/config.js` + `.env.example` + `.env.test` — new vars (e.g.
  `RESET_TOKEN_TTL`, `SMTP_*` if real mail).
- `tests/unit/` + `tests/integration/` — new suites mirroring auth patterns.
- `openspec/config.yaml` — stale context (scaffold-era facts), refresh.

## Approaches

1. **Email link + DB-backed reset token table** (canonical, recommended)
   `POST /auth/forgot-password` (identifier → always the same generic success
   response) writes a one-time, expiring token (store a **hash** of the
   random token, not the plaintext) keyed to the user; a `MailerPort` delivers
   the link; `POST /auth/reset-password` (token + new password) verifies
   hash/expiry/unused, invalidates the token, and writes the new bcrypt hash.
   - Pros: revocable, single-use, short TTL enforced in DB; follows the
     repo's port/injection pattern exactly; standard, well-understood flow.
   - Cons: needs `email` on users (data migration + backfill question); needs
     mailer infra (SMTP creds or a dev console transport); most moving parts.
   - Effort: Medium-High.

2. **Signed JWT reset link, no new table**
   `forgot-password` signs a short-lived JWT (`purpose: 'password-reset'`,
   e.g. 15–30 min, distinct audience, ideally a separate secret) and mails
   it; `reset-password` verifies purpose + expiry and updates the hash.
   - Pros: reuses `jsonwebtoken`; zero new tables; stateless.
   - Cons: NOT revocable (replayable until expiry, cannot mark used); link
     tokens leak via logs/referrers; still needs mailer + email column;
     must be careful to distinguish reset JWTs from access JWTs.
   - Effort: Low-Medium.

3. **OTP code** (6-digit, emailed)
   `forgot-password` generates a code, stores a hash with expiry, mails it;
   `reset-password` takes code + new password.
   - Pros: no link-clicking; app/SMS-friendly later; simple UX.
   - Cons: still needs mailer + email column; brute-forceable without rate
     limiting (guessing space is small — needs attempt caps); user has to
     type a code.
   - Effort: Medium.

**All three share the same hard dependency**: an email address on the user
record AND a delivery channel. Without them, the only fallback is an
admin-mediated reset (admin generates/communicates a code offline), which
contradicts the self-service intent of "recuperar contraseña".

## Recommendation

Approach 1 (email link + DB-backed reset token), delivered in the repo's
idiom: a `MailerPort` seam with a `ConsoleMailer` dev implementation
(log-the-link transport, like the `OpenGuard` seam) and — pending user
confirmation of an SMTP provider — a Nodemailer implementation behind the
same port. Store `sha256(token)` in the table so a DB leak exposes nothing
usable. Always return the same generic response from `forgot-password`
regardless of whether the identifier exists (matches the existing
anti-enumeration stance of login's generic 401). Add `email` to `users`
(nullable for existing rows; policy for new registrations is a spec
question). The design must also add `updatePassword` to the user repository.

## Risks

- **Email delivery is the crux**: no SMTP creds exist. The proposal round
  must decide: real Nodemailer (user supplies SMTP vars) vs. console/log
  transport now with the seam for later. A hardcoded "fake" mailer in
  production is a security hole — scope must state when real delivery lands.
- **No email column on users**: adding it requires a backfill strategy for
  existing users (empty/null? seed from `patients.email`? deny recovery for
  users without email?). Business decision.
- **Enumeration via response differences**: reset flows must not reveal
  whether a username/email exists (login already sets this precedent). All
  branches (found, not found, rate-capped) should respond identically.
- **No rate limiting exists**: brute-force of OTPs/reset tokens and
  mail-bombing are unaddressed. Options: minimal per-user outstanding-token
  cap + short TTL (no new dep) vs. `express-rate-limit` (new dep) — user
  preference needed; full rate limiting may be a follow-up change.
- **Custom migration runner is forward-only**: `003_*` must be purely
  additive; a NOT NULL email column cannot be backfilled in the same
  migration without a data step.
- **Frontend target unknown**: the reset link must point somewhere
  (`CLIENT_URL` / `FRONTEND_URL` env var?) or be API-only for now — ask the
  user; there is no frontend repo in this workspace.
- **Review budget**: ~500–900 lines forecast → tasks phase should plan
  chained PRs (foundation/migration → use cases → routes/mailer → tests).
- **Stale `openspec/config.yaml`**: refresh context so downstream phases
  don't trust outdated facts.

## Ready for Proposal

Yes. The proposal question round should get from the user: (1) delivery
channel — real SMTP now or console/dev seam first; (2) whether to add an
`email` column to `users` and the backfill/requirement policy for it; (3)
preferred reset medium — email link (recommended), OTP code, or
admin-mediated fallback; (4) frontend URL for the reset link or API-only;
(5) rate-limiting appetite (minimal cap vs. `express-rate-limit`).
