# Design: Profile Read Endpoint & Permission-Driven Guards

## Technical Approach

Additive, following the AdminGuard-era wiring: extend the existing `Guard`-class policy seam, add a thin read path, swap guard instances **only at wiring time** (`src/app.ts`), and ship a transactional SQL migration.

- **Workstream A — `GET /auth/me`**: `findById` on `UserRepositoryPort` + `PgUserRepository` (PK read); new `GetCurrentUser` use case mapping the fresh row to `{username, email, role}`; auth router gains `GET /me` behind `authenticate` + `PermissionGuard('profile:read')` (PR-001/PR-002).
- **Workstream B — guards**: `PermissionGuard` beside `AdminGuard` (same `Guard` port, reads `req.auth.permissions`); matrix pinned in `permissions.ts`; four write mounts swap guards with identical 401/403 (PG-002/PG-003).
- **Migration `005`**: pre-check `DO $$` block (fails loudly, no auto-repair) then UNIQUE constraints (STU-006/TEA-005).

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Guard mechanics | `PermissionGuard extends Guard`, `authorize(req)` called in-handler after `authenticate` middleware | Express middleware guard | Existing AdminGuard pattern; swap is wiring-only; identical 401/403; use case never runs on rejection |
| Auth router deps | Keep `guard` (register → `users:write`); add optional `meMiddleware` + `meGuard` | Guards-map param | Minimal diff; register tests untouched; `/me` stays unmounted until wired |
| `findById` contract | `findById(userId): Promise<User\|null>`, full `USER_COLUMNS` select + `rowToUser` | Slim `SELECT username,email,role` DTO | Parity with `findByUsername`/`findByEmail`; exclusion happens at the response boundary |
| Sensitive-field exclusion | Use case returns narrow `CurrentUserOutput`; `toJSON()` NOT reused | Reuse `toJSON()` | `toJSON()` exposes `id`/`createdAt`; PR-001 requires exactly three keys |
| Unknown subject | Use case throws `UnauthorizedError` (PR-002) | Route-level check | Policy stays in app layer; status/code is the contract |
| Migration pre-check | `DO $$` block inside `005` file, before DDL; `RAISE EXCEPTION` lists dups | Separate node pre-script | migrate.ts wraps each file in one transaction: raise rolls back DDL and skips `schema_migrations`; spec wording "migration MUST first run" |
| Constraint style | `ADD CONSTRAINT students_user_id_unique UNIQUE (user_id)` | UNIQUE index | Mirrors `students_codalumno_unique` naming; rollback = `DROP CONSTRAINT` |
| Admin token helper | `seedAdmin` derives perms from `ROLE_PERMISSIONS.admin` | Hardcode `profile:read` | Prevents drift; admin token needs `profile:read` for `/me` 200 (PG-003) |

## Data Flow

```
Guard pipeline (all 5 mounts):
client ─▶ authenticate (Bearer verify; invalid ⇒ 401) ─▶ req.auth = {role, permissions, sub, userId}
        ─▶ PermissionGuard.authorize(req) ─ 401 if !req.auth | 403 if perm ∉ req.auth.permissions
        ─▶ handler → use case → response        (rejected ⇒ handler and use case never run)

GET /auth/me:
router.get('/me', authenticate) ─▶ meGuard.authorize ─▶ GetCurrentUser.execute({ userId: req.auth.userId ?? sub })
   └─ UserRepository.findById(userId) ─▶ users row by PK ── null ⇒ 401 Unauthorized
   └─ 200 { username, email, role }   ← built from the fresh row; JWT claims never enter the payload
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/modules/auth/application/auth.ports.ts` | Modify | Add `findById(userId)` to `UserRepositoryPort` |
| `src/modules/auth/infrastructure/repositories/pg-user.repository.ts` | Modify | `findById`: `SELECT ${USER_COLUMNS} FROM users WHERE id = $1` → `rowToUser` |
| `src/modules/auth/application/get-current-user.usecase.ts` | Create | `GetCurrentUser` → `CurrentUserOutput`; null → 401 |
| `src/modules/auth/infrastructure/routes/auth.routes.ts` | Modify | `GET /me` via `meMiddleware` + `meGuard`; register handler untouched |
| `src/modules/shared/application/guard.ts` | Modify | Add `PermissionGuard(permission)` |
| `src/modules/auth/domain/permissions.ts` | Modify | Pin matrix, `IMPLEMENTED_PERMISSIONS`; `materias:read`/`turnos:read` inert |
| `src/app.ts` | Modify | Wiring: `users:write`, `students:write`, `teachers:write`, `patients:write`, `profile:read` |
| `src/db/migrations/005_user_id_unique_profiles.sql` | Create | Pre-check + UNIQUE constraints |
| `tests/unit/{guard,permissions,pg-user-repository}.test.js` | Modify | PG-002, PG-001, findById |
| `tests/unit/get-current-user.test.js` | Create | PR-001/PR-002 unit |
| `tests/integration/auth.test.js` | Modify | `/me`: 200 (3 keys), 401, 403, fresh-read, profile-less admin |
| `tests/integration/wiring.test.js` | Modify | 5-mount 401/403 + admin preserved (PG-003) |
| `tests/integration/helpers/admin-token.js` | Modify | `seedAdmin` perms from `ROLE_PERMISSIONS.admin` |
| `tests/integration/migration-precheck.test.js` | Create | STU-006/TEA-005 abort + constraint rejection |

## Interfaces / Contracts

```ts
// auth.ports.ts
findById(userId: string): Promise<User | null>;

// get-current-user.usecase.ts
interface GetCurrentUserInput { userId: string; }
interface CurrentUserOutput { username: string; email: string | null; role: string; }

// shared/application/guard.ts
export class PermissionGuard extends Guard {
  constructor(private readonly requiredPermission: string) { super(); }
  async authorize(request: Request): Promise<void> {
    const authReq = request as AuthenticatedRequest;
    if (!authReq.auth) throw new UnauthorizedError('Authentication required');
    if (!authReq.auth.permissions.includes(this.requiredPermission))
      throw new ForbiddenError(`Permission '${this.requiredPermission}' required`);
  }
}
```

## Migration 005 (SQL sketch)

```sql
DO $$DECLARE d text;BEGIN
  SELECT string_agg(format('%s -> {%s}', user_id, string_agg(id::text, ', ')), '; ')
    INTO d FROM students GROUP BY user_id HAVING count(*) > 1;
  IF d IS NOT NULL THEN RAISE EXCEPTION 'students.user_id duplicates: %', d; END IF;
  SELECT string_agg(format('%s -> {%s}', user_id, string_agg(id::text, ', ')), '; ')
    INTO d FROM teachers GROUP BY user_id HAVING count(*) > 1;
  IF d IS NOT NULL THEN RAISE EXCEPTION 'teachers.user_id duplicates: %', d; END IF;
END $$;
ALTER TABLE students ADD CONSTRAINT students_user_id_unique UNIQUE (user_id);
ALTER TABLE teachers ADD CONSTRAINT teachers_user_id_unique UNIQUE (user_id);
```

Naming: `NNN_snake_case.sql` (next after `004`). migrate.ts runs the file in one transaction: a raise aborts everything — no DDL applied, no `schema_migrations` row, exit 1, affected `user_id` + profile `id`s in the error. Rollback: `DROP CONSTRAINT students_user_id_unique / teachers_user_id_unique` — additive, no data loss.

## Testing Strategy

| Layer | Spec | What | Approach |
|---|---|---|---|
| Unit | PG-002 | PermissionGuard 401/403/allow | extend `guard.test.js` |
| Unit | PG-001 | matrix pin, inert claims never enforced | extend `permissions.test.js` |
| Unit | PR-001/PR-002 | exactly 3 keys, hash/audit absent, null → 401 | new `get-current-user.test.js` |
| Unit | — | findById SQL `WHERE id = $1`, null mapping | extend `pg-user-repository.test.js` (fake pool) |
| Integration | PR-001/002 | /me 200 exact body; 401 no-token/expired/unknown-subject; 403 no `profile:read`; email UPDATE then /me shows new value; bootstrapped admin (email null) 200 | `auth.test.js` |
| Integration | PG-003 | five mounts 401/403, admin → 201×4 + 200 | `wiring.test.js` |
| Integration | STU-006/TEA-005 | dup rows abort pre-check (txn + ROLLBACK); second insert for same `user_id` → 23505 | `migration-precheck.test.js` |

## Migration / Rollout

No feature flag. `pretest` applies 005 to the test DB; prod via `pnpm db:migrate`. Rollback: DROP CONSTRAINT or revert commit (GET /auth/me is additive; existing endpoints keep identical status codes).

## Task Boundaries & PR Slicing

~550–700 changed lines → exceeds the 400-line review budget. Recommend **chained PRs**, independently verifiable slices:
1. **A — profile read**: ports/repo + use case + `/me` route + wiring + A tests.
2. **B — guards**: PermissionGuard + matrix pin + four mount swaps + wiring/helper tests.
3. **C — migration**: `005` SQL + pre-check integration test.
Decision needed before apply: Yes — confirm `ask-on-risk`/`auto-chain` strategy.

## Open Questions

- Translate the new `students_user_id_unique` 23505 in the create-student link path (today untranslated → 500)? **USER DECISION (2026-09-18): OUT OF SCOPE — record as known debt.** Specs require only DB rejection; the 23505 → 500 in link path stays as accepted debt, tracked for a future change.
- Drop now-redundant `students_user_id_idx`/`teachers_user_id_idx` in a follow-up? Kept here for rollback simplicity.