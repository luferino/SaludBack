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
   ```

   `DATABASE_URL` points at the dev database; `JWT_SECRET` is required — the
   server fails fast at boot if it is missing.
3. Apply migrations **before the first boot**: `pnpm db:migrate`
4. Start the API: `pnpm dev` (or `node --env-file=.env src/index.js`)

The server listens on `PORT` (default `3000`).

## Endpoints

- `POST /auth/register` — create an `estudiante` account. Open today while no
  admin role exists; registration sits behind a guard seam so an admin-only
  policy can be attached later without rework.
- `POST /auth/login` — username + password. Returns `200 { token }` carrying
  `role` and `permissions` claims; unknown usernames and wrong passwords both
  return a generic `401`.

## Testing

`pnpm test` runs the full suite (unit + integration against `saludback_test`).
The `pretest` hook migrates the test database automatically, so a fresh
`pnpm test` exercises the real schema.

## Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | — | required; PostgreSQL connection string |
| `JWT_SECRET` | — | required; token signing secret |
| `JWT_EXPIRES_IN` | `2h` | access-token lifetime |
| `BCRYPT_COST` | `12` | bcrypt cost factor for password hashing |
