# Design: Student Registration and Login (Auth Foundation)

## Technical Approach

Modular Clean Architecture on the Express 5 scaffold: `modules/auth/{domain,application,infrastructure}` + shared cross-cutting in `modules/shared/`. Register/login are application-layer use-cases with injected ports (repository, hasher, token, guard) implemented in infrastructure (`pg`, `bcryptjs`, `jsonwebtoken`). Plain-SQL migrations + small runner. Satisfies `user-registration` and `user-auth`.

## Architecture Decisions

### Token mechanism — JWT, no refresh rotation

**Choice**: signed JWT (`jsonwebtoken`), single access token with `exp`; refresh rotation explicitly deferred.
**Alternatives**: server-side sessions (stateful infra); refresh+rotation now.
**Rationale**: specs need client-carried role/permissions claims; stateless JWT needs no session store. Seam: token creation flows through the `TokenService` port — refresh tokens later are a new method, not a use-case change.

### Token claims contract

```js
{ sub, username, role, permissions, iat, exp, iss: 'SaludBack', aud: 'SaludBack-api' }
```

**Rationale**: `sub` = stable id (no PII); role+permissions drive authz; iss/aud block cross-app reuse; hash never included.

### role → permissions derivation

**Choice**: static map `modules/auth/domain/permissions.js`:

```js
export const ROLE_PERMISSIONS = { estudiante: ['profile:read', 'materias:read', 'turnos:read'] };
```

Naming `<resource>:<action>`; future roles add keys. **Rationale**: domain-owned, trivially extensible.

### Guard seam as policy boundary

**Choice**: `Guard` port in `modules/shared/application/guard.js`: `authorize(request)` → resolves or throws `UnauthorizedError`. Injected at route wiring; `OpenGuard` (allow-all) defaults for `/auth/register`; future `AdminGuard` swaps in — a drop-in, never a use-case change.

### Modular structure

Dependency direction `domain ← application ← infrastructure`; nothing depends outward. Shared: errors, guard; role model stays in `modules/auth/domain/` (proposal).

### Persistence and migrations

**Choice**: versioned plain-SQL + runner. `db/migrations/001_create_users.sql`:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`db/migrate.js` (node + `pg`): applies `*.sql` in filename order, records in `schema_migrations`, per-file transactions. `pnpm db:migrate`. **Alternatives**: Drizzle/Knex (overkill); boot-time SQL (no history). **Rationale**: one table; small runner = ordered, idempotent migrations; rollback `DROP TABLE users`.

### Env/config

**Choice**: `src/config.js` validates env via Node 24 native `process.loadEnvFile()` — no dotenv. `.env.example` committed; `.env` gitignored.

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://localhost:5432/saludback` | |
| `JWT_SECRET` | — | required, fail fast |
| `JWT_EXPIRES_IN` | `2h` | |
| `BCRYPT_COST` | `12` | |

### ESM pinned

**Choice**: `"type": "module"` in package.json. **Rationale**: already ESM; explicit pin = deterministic resolution for `node --test` and tooling.

### Dependencies

**Choice**: `bcryptjs` (pure JS, no native build), `jsonwebtoken`; no dotenv. **Alternatives**: `bcrypt` (node-gyp pain), `jose` (unneeded).

## Data Flow

```
register:  Guard(Open) ──> validate ──> hash ──> findByUsername (dup ──> 409) ──> create ──> 201
login:     validate ──> findByUsername ──> compare (fail ──> generic 401) ──> sign ──> 200 {token}
protected: authenticate ──> verify ──> req.auth { role, permissions } (bad ──> 401)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `modules/shared/domain/errors.js` | Create | `AppError` + 400/409/401 |
| `modules/shared/application/guard.js` | Create | `Guard` port + `OpenGuard` |
| `modules/auth/domain/user.js` | Create | `User` entity |
| `modules/auth/domain/permissions.js` | Create | `ROLE_PERMISSIONS` map |
| `modules/auth/application/ports.js` | Create | repo/hasher/token ports |
| `modules/auth/application/register-user.js` | Create | register use case |
| `modules/auth/application/login-user.js` | Create | login use case |
| `modules/auth/infrastructure/services/bcrypt-hasher.js` | Create | `PasswordHasher` (bcryptjs) |
| `modules/auth/infrastructure/services/jwt-token-service.js` | Create | `TokenService` (jsonwebtoken) |
| `modules/auth/infrastructure/repositories/pg-user-repository.js` | Create | `UserRepository` (`pg`) |
| `modules/auth/infrastructure/middleware/authenticate.js` | Create | verify → `req.auth`; 401 |
| `modules/auth/infrastructure/routes/auth.routes.js` | Create | routes + guard wiring |
| `src/db/migrate.js` | Create | migration runner |
| `src/db/migrations/001_create_users.sql` | Create | users DDL |
| `src/config.js` | Modify | env config |
| `src/index.js` | Modify | mount `/auth`, parsers, handler |
| `src/middleware/error-handler.js` | Create | `AppError` → JSON; unknown → 500 |
| `tests/unit/*.test.js` | Create | unit tests |
| `tests/integration/auth.test.js` | Create | HTTP smoke |
| `package.json` | Modify | ESM, deps, scripts |
| `.env.example` | Create | env docs |
| `.gitignore` | Modify | ignore `.env` |

## Interfaces / Contracts

```js
UserRepository { findByUsername(username); create(user); }
PasswordHasher { hash(plain); compare(plain, hash); }   // compare -> Promise<boolean>
TokenService  { sign(claims); verify(token); }           // verify -> decoded | throws
```

User = plain entity; deps injected → fake-testable.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | register (success/dup→409/empty→400); login (success/unknown/wrong-pw→401); hasher roundtrip; token sign/verify; permissions; OpenGuard | `node:test` + fakes |
| Integration | HTTP: register 201/409/400; login 200+claims/401/400; middleware 401 | `node:test`, ephemeral port + `fetch`, test DB |

Scripts: `"test": "node --test"`, `"pretest": "node --env-file=.env.test db/migrate.js"`, `"db:migrate": "node --env-file=.env db/migrate.js"`.

## Migration / Rollout

`pnpm db:migrate` before first boot. Rollback: `DROP TABLE users` + revert code; no consumers depend on auth.

## Open Questions

None blocking. Later: `medico`/`admin` permission names.
