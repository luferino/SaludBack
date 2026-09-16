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
| `POST` | `/auth/register` | create `estudiante` account — **admin Bearer token required** |
| `POST` | `/auth/login` | username + password → token |
| `POST` | `/auth/forgot-password` | request a password-reset link |
| `POST` | `/auth/reset-password` | redeem a reset token |
| `POST` | `/students` | alta en uno: account + student profile — **admin Bearer token required** |
| `POST` | `/teachers` | alta en uno: account + teacher profile — **admin Bearer token required** |
| `POST` | `/patients` | patient record (no account) — **admin Bearer token required** |

Protected endpoints (`/auth/register`, `/students`, `/teachers`, `/patients`)
verify the Bearer token first: `401` without a valid token, `403` when the
token's role is not `admin`, `201` otherwise. `POST /auth/login` and both
password-recovery endpoints stay public — they are the entry points.

### POST /auth/register

Creates an `estudiante` account. Requires an **admin Bearer token**
(`Authorization: Bearer <token>`); an `admin` token is created via the
first-admin bootstrap below.

- Body: `{ "username", "password", "email" }` — all required
- `201` → `{ "id", "username", "role": "estudiante", "email", "createdAt" }`
- `400` — validation failure (see [Validation rules](#validation-rules));
  `401` — missing/invalid token; `403` — non-admin token;
  `409` — duplicate username or email

```bash
curl.exe -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -H "Authorization: Bearer <admin-token>" -d '{"username":"jperez","password":"secret12345","email":"jperez@example.com"}'
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
profile row in one transaction. Requires an **admin Bearer token**;
`created_by` records the admin user id from the token.

- Body: `{ "username", "password", "nombres", "apellidos", "codalumno", "email"?, "celular"? }`
- `201` → `{ "id", "nombres", "apellidos", "codalumno", "email", "celular", "created_by", "created_at" }`
- `400` — missing required field; `username` not A-Z0-9 (stored UPPERCASE);
  `password` under 10 chars or without a letter+digit; `codalumno` not purely
  alphanumeric (`^[A-Za-z0-9]+$`); `email` present but not a valid address;
  `401` — missing/invalid token; `403` — non-admin token;
  `409` — duplicate `codalumno`

```bash
curl.exe -X POST http://localhost:3000/students -H "Content-Type: application/json" -H "Authorization: Bearer <admin-token>" -d '{"username":"jperez","password":"secret12345","nombres":"Juan","apellidos":"Perez","codalumno":"20240123","email":"jperez@example.com"}'
```

### POST /teachers

Alta en uno: creates the access account (role `teacher`) and the `teachers`
profile row in one transaction. Requires an **admin Bearer token**;
`created_by` records the admin user id from the token.

- Body: `{ "username", "password", "nombres", "apellidos", "email"?, "celular"? }`
- `201` → `{ "id", "nombres", "apellidos", "email", "celular", "created_by", "created_at" }`
- `400` — missing required field; `username` not A-Z0-9 (stored UPPERCASE);
  `password` under 10 chars or without a letter+digit; `email` present but not
  a valid address; `401` — missing/invalid token; `403` — non-admin token

```bash
curl.exe -X POST http://localhost:3000/teachers -H "Content-Type: application/json" -H "Authorization: Bearer <admin-token>" -d '{"username":"mruiz","password":"secret12345","nombres":"Maria","apellidos":"Ruiz","email":"mruiz@example.com"}'
```

### POST /patients

Clinical entity only — no account is created. Requires an **admin Bearer
token**; `created_by` records the admin user id from the token.

- Body: `{ "documento", "nombres", "apellidos", "fecha_nacimiento", "email", "celular", "sexo", "direccion" }` — all required
- `201` → `{ "id", "documento", "nombres", "apellidos", "fecha_nacimiento", "email", "celular", "sexo", "direccion", "created_by", "created_at" }`
- `400` — missing field; `documento` not 4-8 digits; `sexo` not `M` or `F`;
  `fecha_nacimiento` not a real `YYYY-MM-DD` date or in the future; `email`
  not a valid address; `401` — missing/invalid token;
  `403` — non-admin token; `409` — duplicate `documento`

```bash
curl.exe -X POST http://localhost:3000/patients -H "Content-Type: application/json" -H "Authorization: Bearer <admin-token>" -d '{"documento":"12345678","nombres":"Ana","apellidos":"Lopez","fecha_nacimiento":"1990-05-10","email":"ana@example.com","celular":"+5491100000000","sexo":"F","direccion":"Av. Siempre Viva 123"}'
```

### First admin bootstrap

Once register is admin-only, the first admin cannot be created through the
API. The bootstrap CLI creates one directly in the database (dev-only):

```bash
pnpm create-admin -- --username ROOTUSER --password <PASSWORD>
```

`--password` passes the secret on the command line, which can end up in your
shell history — prefer the env fallback for production-shaped credentials:

```bash
$env:ADMIN_USERNAME = "ROOTUSER"; $env:ADMIN_PASSWORD = "<PASSWORD>"; pnpm create-admin
```

Or set `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env`. It enforces the same
rules as register (username A-Z0-9 stored UPPERCASE; password min 10 chars
with a letter and a digit) and exits `1` on invalid input or an existing
username.

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

The alta-en-uno flows (`POST /students`, `POST /teachers`) enforce the same
shared rules for `username` and `password` as register — usernames are stored
UPPERCASE and passwords must be 10+ chars with a letter and a digit. Unlike
register, their `email` stays optional: it is validated with the same standard
format only when present.

## JWT

Login returns a bearer token signed with `JWT_SECRET` (lifetime
`JWT_EXPIRES_IN`, default `2h`).

- Claims: `sub` (user id), `username`, `role`, `permissions`, `iat`, `exp`,
  `iss: "SaludBack"`, `aud: "SaludBack-api"`. No secrets in the payload.
- Roles: `estudiante`, `teacher`, `admin` — `permissions` is derived from the
  role at login time; `admin` carries an explicit management set
  (`users:write`, `students:write`, `teachers:write`, `patients:write`,
  `profile:read`, `materias:read`, `turnos:read`).
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
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | optional; fallback credentials when `pnpm create-admin` runs without `--username`/`--password` |

## Testing

`pnpm test` runs the full suite (unit + integration against `saludback_test`).
The `pretest` hook migrates the test database automatically, so a fresh
`pnpm test` exercises the real schema.