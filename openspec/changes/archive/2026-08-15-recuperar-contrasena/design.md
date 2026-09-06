# Design: Password Recovery (recuperar contraseña)

## Technical Approach

Self-service reset in the auth module's existing Clean Architecture idiom: two public use cases (`RequestPasswordReset`, `ResetPassword`) behind `auth.routes.js`, ports in `application/ports.js`, PG adapters in `infrastructure/repositories/`, and a new `MailerPort` seam with a `ConsoleMailer` adapter. Additive migration `003` adds `users.email` (nullable, unique) and `password_reset_tokens`. JWT stays stateless — reset never touches sessions. No new dependencies: `node:crypto` for tokens, `bcryptjs` cost 12 for hashing.

## Architecture Decisions

| # | Decision | Options | Choice |
|---|---|---|---|
| D1 | Mailer seam | direct call / port+adapter | `MailerPort` in application, `ConsoleMailer` in `infrastructure/services/`; SMTP later = new class, index.js wiring only. |
| D2 | `users.email` | nullable / backfilled | Nullable + unique index (PG allows multiple NULLs); legacy rows stay NULL, no backfill (no users↔patients join key). |
| D3 | Token at rest | raw / bcrypt / sha256 | `sha256` of raw 32-byte `randomBytes` token, `UNIQUE` column; raw token only in the mailed link. |
| D4 | Single-use + cap | delete vs `used_at`; app vs SQL cap | `used_at` marks unusable (one concept for used/invalidated); cap `RESET_TOKEN_MAX_OUTSTANDING` (default 3) enforced atomically in one SQL statement (keep newest N, mark older used). |
| D5 | Invalid-token response | 401 / 400 / 404 | Single `BadRequestError('Invalid or expired reset token')` — unknown/used/expired all collapse to `findValidByHash` null (login's generic-error precedent). |
| D6 | Forgot-password response | per-branch / generic | One 200 body `{ message: 'If the account exists, a password reset link has been sent' }` on every non-400 path; unknown user and NULL email both fold into "no mail". |
| D7 | Reset vs sessions | invalidate JWTs / leave valid | Leave valid — stateless JWT, no store/denylist (spec). Future direction: `ver` claim checked in `authenticate`; documented, not built. |
| D8 | Mark-then-update | update-then-mark / mark-then-update | `markUsed` before `updatePassword`: single-use is the security property; a crash in between forces a re-request, never token replay. |
| D9 | Config | env with defaults, injected | `CLIENT_URL` added to `REQUIRED_ENV` (boot fails without it, per spec); `RESET_TOKEN_TTL` (minutes, default 15) and cap env-with-default like `BCRYPT_COST`; injected via constructors (no env in use cases). |
| D10 | Email validation | reuse / new | Reuse create-patient regex `^[^@\s]+@[^@\s]+$`; duplicate email → `ConflictError` 409 mirroring duplicate-username; use-case check + DB unique index. |

## Data Flow

```
POST /auth/forgot-password {username}
  RequestPasswordReset.execute
    repository.findByUsername ── null or email NULL ──► return generic body, no mail
        │ user + email
        ▼
    raw = randomBytes(32)  →  link = `${clientUrl}?token=${raw}`
    resetTokenRepository.create({ userId, tokenHash: sha256(raw), expiresAt })   (cap enforced)
    mailer.sendMail({ to, subject, text: link })  ──► ConsoleMailer prints to stdout
    return generic body

POST /auth/reset-password {token, newPassword}
  ResetPassword.execute
    tokenHash = sha256(token)
    resetTokenRepository.findValidByHash ── null ──► 400 'Invalid or expired reset token'
        │ row
        ▼
    hasher.hash(newPassword) → markUsed(row.id) → repository.updatePassword(row.userId, hash)
    return 200 { message: 'Password has been reset' }
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/db/migrations/003_add_email_and_reset_tokens.sql` | Create | Additive: `users.email` + unique index; `password_reset_tokens` table |
| `src/modules/auth/domain/user.js` | Modify | Add `email` field |
| `src/modules/auth/domain/password-reset-token.js` | Create | Token entity (`id, userId, tokenHash, expiresAt, usedAt, createdAt`) |
| `src/modules/auth/application/ports.js` | Modify | `UserRepositoryPort.findByEmail`/`updatePassword`; new `ResetTokenRepositoryPort` (create / findValidByHash / markUsed) and `MailerPort.sendMail` |
| `src/modules/auth/application/register-user.js` | Modify | Email required + duplicate-email 409 |
| `src/modules/auth/application/request-password-reset.js` | Create | Forgot-password use case |
| `src/modules/auth/application/reset-password.js` | Create | Reset use case |
| `src/modules/auth/infrastructure/repositories/pg-user-repository.js` | Modify | Email in CRUD; `findByEmail`, `updatePassword` |
| `src/modules/auth/infrastructure/repositories/pg-reset-token-repository.js` | Create | PG adapter; atomic cap enforcement |
| `src/modules/auth/infrastructure/services/console-mailer.js` | Create | `MailerPort` impl logging link to stdout |
| `src/modules/auth/infrastructure/routes/auth.routes.js` | Modify | `POST /forgot-password`, `POST /reset-password` (no guard, like login); new injected deps |
| `src/index.js` | Modify | Wire `PgResetTokenRepository`, `ConsoleMailer`, pass `clientUrl` |
| `src/config.js` | Modify | `CLIENT_URL` required; `RESET_TOKEN_TTL`, `RESET_TOKEN_MAX_OUTSTANDING` |
| `.env.example`, `.env.test` | Modify | New vars |
| `tests/unit/` | Create/Modify | 4 new suites; extend register-user + pg-user-repository |
| `tests/integration/auth.test.js` | Modify | Reset flow e2e; `DELETE FROM password_reset_tokens` in `before()` |

## Interfaces / Contracts

```js
export class MailerPort {
  async sendMail({ to, subject, text }) { throw new Error('MailerPort#sendMail is not implemented'); }
}
export class ResetTokenRepositoryPort {
  async create({ userId, tokenHash, expiresAt }) {} // enforces outstanding cap
  async findValidByHash(tokenHash) {}               // null for unknown / used / expired
  async markUsed(id) {}
}
// UserRepositoryPort gains:
//   async findByEmail(email) {}
//   async updatePassword(userId, newPasswordHash) {}
```

Non-obvious SQL — cap + insert, one atomic statement (repo `create`): `WITH inserted AS (INSERT … RETURNING id), overflow AS (SELECT id FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL ORDER BY created_at DESC, id DESC OFFSET $4) UPDATE password_reset_tokens SET used_at=now() FROM overflow WHERE overflow.id = password_reset_tokens.id`.

Migration `003`: `ALTER TABLE users ADD COLUMN email TEXT` + unique index on `email`; table `password_reset_tokens (id UUID PK, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())` + index on `user_id`.

HTTP contract: `POST /auth/forgot-password {username}` → 400 `BAD_REQUEST` | 200 generic body; `POST /auth/reset-password {token, newPassword}` → 400 `BAD_REQUEST` | 200 `{ message: 'Password has been reset' }`.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `RequestPasswordReset` | Fake repo/mailer: identical body for unknown / email-less / has-email; mailed link's raw token hashes (sha256) to the captured stored hash; no mail when none expected |
| Unit | `ResetPassword` | Valid → markUsed+update called; unknown/used/expired → one generic error, password untouched; missing fields → 400 |
| Unit | `PgResetTokenRepository` | Fake pool asserts insert params and overflow marking SQL |
| Unit | register-user, `PgUserRepository`, `ConsoleMailer` | Email 400/409; `findByEmail`/`updatePassword` SQL; link on stdout |
| Integration | `tests/integration/auth.test.js` | Register + forgot + reset via recording mailer; old password fails after reset, new works; token reuse rejected; expired token (direct SQL insert) rejected; N+1 issuance invalidates oldest |

## Migration / Rollout

`003` runs through the forward-only custom runner (`src/db/migrate.js`, tracked in `schema_migrations`, transactional) and is purely additive — safe to apply before code ships. No backfill. Rollback: redeploy previous build; new endpoints idle, table/column harmless. Deploy requires `CLIENT_URL` in env or boot fails by design (spec requirement).

## Open Questions

- [ ] Timing side-channel between existing/unknown username remains (no dummy-work equalization) — accepted for this slice?
- [ ] Refresh stale `openspec/config.yaml` (scaffold-era facts) — hygiene task outside this change.
- [ ] Real `CLIENT_URL` value and SMTP provider/timing — deferred by proposal decisions.
