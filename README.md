# SaludBack

Health-domain backend API. Node.js 24 + Express 5 + PostgreSQL, structured as
modular Clean Architecture (`src/modules/<module>/{domain,application,infrastructure}`).

## Prerequisites

- Node.js 24+ (uses `process.loadEnvFile()` and the native `--env-file` flag)
- pnpm 10
- A running PostgreSQL instance with two databases: `saludback` (dev) and
  `saludback_test` (integration tests)

## Setup

1. Install dependencies: `pnpm install`
2. Create `.env` from the template and fill in the values:

   ```
   DATABASE_URL=postgres://localhost:5432/saludback
   JWT_SECRET=replace-with-a-long-random-secret
   CLIENT_URL=http://localhost:3000/reset
   ```

   `DATABASE_URL`, `JWT_SECRET`, and `CLIENT_URL` are required — the server
   fails fast at boot if any is missing.
3. Apply migrations **before the first boot**: `pnpm db:migrate`
4. Start the API: `pnpm dev` (or `node --env-file=.env src/index.js`)

The server listens on `PORT` (default `3000`). Confirm it is up:

```bash
curl.exe http://localhost:3000/
# Hello, World!
```

## Endpoints

All examples use `curl.exe` against `http://localhost:3000` and are
PowerShell-friendly (single-quoted JSON bodies). Request bodies are JSON;
errors return `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | health check |
| `POST` | `/auth/register` | create `estudiante` account |
| `POST` | `/auth/login` | username + password → token |
| `POST` | `/auth/forgot-password` | request a password-reset link |
| `POST` | `/auth/reset-password` | redeem a reset token |
| `POST` | `/students` | alta en uno: account + student profile |
| `POST` | `/teachers` | alta en uno: account + teacher profile |
| `POST` | `/patients` | patient record (no account) |

### POST /auth/register

Creates an `estudiante` account. Open today while no admin role exists; the
route sits behind a guard seam so an admin-only policy can be attached later
without rework.

- Body: `{ "username", "password", "email" }` — all required
- `201` → `{ "id", "username", "role": "estudiante", "email", "createdAt" }`
- `400` — validation failure (see [Validation rules](#validation-rules));
  `409` — duplicate username or email

```bash
curl.exe -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d '{"username":"jperez","password":"secret12345","email":"jperez@example.com"}'
```

### POST /auth/login

- Body: `{ "username", "password" }` — both required; `username` is
  normalized to uppercase before lookup, so lowercase input works
- `200` → `{ "token" }`
- `400` — missing/empty fields; `401` — generic error for both unknown
  username and wrong password (no user enumeration)

```bash
curl.exe -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"username":"jperez","password":"secret12345"}'
```

### POST /auth/forgot-password

- Body: `{ "username" }` — required, normalized to uppercase before lookup
- `200` → generic message whether the user exists, has no email, or does not
  exist (anti-enumeration), e.g. `{ "message": "If the account exists, a password reset link has been sent" }`
- `400` — missing/empty `username`

```bash
curl.exe -X POST http://localhost:3000/auth/forgot-password -H "Content-Type: application/json" -d '{"username":"jperez"}'
```

### POST /auth/reset-password

- Body: `{ "token", "newPassword" }` — both required; `newPassword` must pass
  the same strength rules as register (min 10 chars, letter + digit)
- `200` → `{ "message": "Password has been reset" }`
- `400` — missing fields, or invalid/expired/used token (single-use token;
  generic error, password unchanged)

```bash
curl.exe -X POST http://localhost:3000/auth/reset-password -H "Content-Type: application/json" -d '{"token":"<token-from-link>","newPassword":"nuevaClave123"}'
```

### POST /students

Alta en uno: creates the access account (role `estudiante`) and the `students`
profile row in one transaction. Open today (no auth middleware); `created_by`
is `null` without a verified token.

- Body: `{ "username", "password", "nombres", "apellidos", "codalumno", "email"?, "celular"? }`
- `201` → `{ "id", "nombres", "apellidos", "codalumno", "email", "celular", "created_by", "created_at" }`
- `400` — missing required field; `codalumno` not purely alphanumeric
  (`^[A-Za-z0-9]+$`); `email` present but not a valid `local@domain` address;
  `409` — duplicate `codalumno`

```bash
curl.exe -X POST http://localhost:3000/students -H "Content-Type: application/json" -d '{"username":"jperez","password":"secret12345","nombres":"Juan","apellidos":"Perez","codalumno":"20240123","email":"jperez@example.com"}'
```

> Note: this flow runs its own local validation — it does NOT yet enforce the
> shared auth rules for `username`/`password` (see [Validation rules](#validation-rules)).

### POST /teachers

Alta en uno: creates the access account (role `teacher`) and the `teachers`
profile row in one transaction. Open today; `created_by` is `null` without a
verified token.

- Body: `{ "username", "password", "nombres", "apellidos", "email"?, "celular"? }`
- `201` → `{ "id", "nombres", "apellidos", "email", "celular", "created_by", "created_at" }`
- `400` — missing required field; `email` present but not a valid
  `local@domain` address

```bash
curl.exe -X POST http://localhost:3000/teachers -H "Content-Type: application/json" -d '{"username":"mruiz","password":"secret12345","nombres":"Maria","apellidos":"Ruiz","email":"mruiz@example.com"}'
```

> Note: this flow runs its own local validation — it does NOT yet enforce the
> shared auth rules for `username`/`password` (see [Validation rules](#validation-rules)).

### POST /patients

Clinical entity only — no account is created. Open today; `created_by` is
`null` without a verified token.

- Body: `{ "documento", "nombres", "apellidos", "fecha_nacimiento", "email", "celular", "sexo", "direccion" }` — all required
- `201` → `{ "id", "documento", "nombres", "apellidos", "fecha_nacimiento", "email", "celular", "sexo", "direccion", "created_by", "created_at" }`
- `400` — missing field; `documento` not 4-8 digits; `sexo` not `M` or `F`;
  `fecha_nacimiento` not a real `YYYY-MM-DD` date or in the future; `email`
  not a valid `local@domain` address; `409` — duplicate `documento`

```bash
curl.exe -X POST http://localhost:3000/patients -H "Content-Type: application/json" -d '{"documento":"12345678","nombres":"Ana","apellidos":"Lopez","fecha_nacimiento":"1990-05-10","email":"ana@example.com","celular":"+5491100000000","sexo":"F","direccion":"Av. Siempre Viva 123"}'
```

## Validation rules

The auth flows share one validation module
(`src/modules/shared/domain/validation.ts`):

| Field | Rule |
|-------|------|
| `username` | required; letters A-Z + digits 0-9 ONLY; stored UPPERCASE (register `jperez` → stored/matched as `JPEREZ`) |
| `password` | required; min 10 chars; at least one letter AND one digit |
| `email` | required for register; standard format |

Applied by `/auth/register` and `/auth/reset-password` (`newPassword`), and
the lookup normalization by `/auth/login` and `/auth/forgot-password`.

> The alta-en-uno flows (`POST /students`, `POST /teachers`) validate input in
> their own use cases and do NOT yet enforce the shared auth rules: their
> `username` is trimmed only (no format check, no uppercase normalization) and
> their `password` has no minimum-length or composition check. Align them with
> the shared module before relying on them as an account-creation path.

## JWT

Login returns a bearer token signed with `JWT_SECRET` (lifetime
`JWT_EXPIRES_IN`, default `2h`).

- Claims: `sub` (user id), `username`, `role`, `permissions`, `iat`, `exp`,
  `iss: "SaludBack"`, `aud: "SaludBack-api"`. No secrets in the payload.
- Header: every signed token carries a `kid` (key id) header identifying the
  signing secret — default `"current"`, configurable via `JWT_SECRET_KID`.
- Verification: the token's `kid` selects the secret — matches
  `JWT_SECRET_KID` → current secret; matches an entry in `JWT_PREVIOUS_SECRETS`
  → that secret; no `kid` (legacy token) → current secret; unknown `kid` →
  rejected (401).

### Rotating the signing secret

1. Generate a new secret:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. Move the current secret into `JWT_PREVIOUS_SECRETS`, keyed by the CURRENT
   kid so existing tokens keep verifying:
   `JWT_PREVIOUS_SECRETS=[{"kid":"current","secret":"<old-secret>"}]`
3. Set `JWT_SECRET` to the new secret and `JWT_SECRET_KID` to a new kid (e.g.
   `2026-09`), then restart. New tokens carry the new kid; tokens signed with
   the old secret still verify via the previous-secrets list.
4. After the old tokens expire (see the `exp` claim), drop
   `JWT_PREVIOUS_SECRETS` and restart.

## Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | — | required; PostgreSQL connection string |
| `JWT_SECRET` | — | required; token signing secret |
| `JWT_SECRET_KID` | `current` | kid stamped into the header of new tokens |
| `JWT_PREVIOUS_SECRETS` | — | optional; JSON array of `{"kid","secret"}` still accepted for verification during rotation |
| `JWT_EXPIRES_IN` | `2h` | access-token lifetime |
| `BCRYPT_COST` | `12` | bcrypt cost factor for password hashing |
| `CLIENT_URL` | — | required; base URL for password-reset links (`{CLIENT_URL}?token=...`) |
| `RESET_TOKEN_TTL` | `15` | reset-token lifetime, in minutes |
| `RESET_TOKEN_MAX_OUTSTANDING` | `3` | cap on outstanding reset tokens per user |

## Testing

`pnpm test` runs the full suite (unit + integration against `saludback_test`).
The `pretest` hook migrates the test database automatically, so a fresh
`pnpm test` exercises the real schema.