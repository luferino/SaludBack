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
| `GET` | `/` | heartbeat only (no database check) |
| `POST` | `/auth/register` | create `estudiante` account — Bearer token + `users:write` |
| `POST` | `/auth/login` | username + password → token |
| `GET` | `/auth/me` | own profile — Bearer token + `profile:read` |
| `POST` | `/auth/forgot-password` | request a password-reset link |
| `POST` | `/auth/reset-password` | redeem a reset token |
| `POST` | `/students` | account + student profile — Bearer token + `students:write` |
| `POST` | `/teachers` | account + teacher profile — Bearer token + `teachers:write` |
| `POST` | `/patients` | patient record (no account) — Bearer token + `patients:write` |
| `POST` | `/subjects` | create subject — Bearer token + `subjects:write` |
| `GET` | `/subjects` | list subjects — Bearer token + `subjects:read` |
| `POST` | `/groups` | create academic group — Bearer token + `groups:write` |
| `GET` | `/groups` | list academic groups — Bearer token + `groups:read` |
| `POST` | `/subject-groups` | associate a subject and academic group — Bearer token + `subject-groups:write` |
| `GET` | `/subject-groups` | list subject/group associations — Bearer token + `subject-groups:read` |
| `POST` | `/teacher-habilitations` | activate teacher in a linked subject/group context — Bearer token + `teacher-habilitations:write` |
| `POST` | `/teacher-habilitations/:id/revoke` | revoke one teacher habilitation period — Bearer token + `teacher-habilitations:revoke` |
| `POST` | `/student-habilitations` | activate a student in an authorized subject/group context — Bearer token + `student-habilitations:write` |
| `POST` | `/patient-assignments` | assign a patient to an active student period — `patient-assignments:write` + active teacher context |
| `GET` | `/patient-assignments` | list assignments in active teacher contexts — `patient-assignments:read` |
| `GET` | `/patient-assignments/mine` | list own assignments — `patient-assignments:read-own` |

For permission-protected routes above, production wiring in `src/app.ts`
verifies the token, reloads grants from `role_permissions` for its verified role,
then applies `PermissionGuard`: invalid token → `401`; missing required grant →
`403`; unreadable/missing matrix tables → `500`. Admin has no bypass; other roles
can pass with the required grant. Authorization does not bypass input validation.
Login and password recovery stay public; login also reads the matrix after
credential validation and fails with `500` if that read fails. This policy does
not redefine the separate role-only `AdminGuard` used by custom router wiring.

### Patient assignments (T2)

`POST /patient-assignments` accepts `{ "patient_id", "student_habilitation_id", "subject_id", "academic_group_id" }`, all UUIDs. A successful `201` returns assignment `id` as a decimal string (BIGINT-safe), patient and exact-period/context identifiers, `assigned_by`, `assigned_at`, and null end facts. Actor identity always comes from the authenticated token. The teacher grant is seeded only for `teacher`; the own-list grant only for `estudiante`. Admin grants do not bypass linked-profile or active-context checks.

Creation locks/revalidates the teacher context, exact active student period, then patient, and relies on a database uniqueness guard for one active patient/subject assignment across groups. Errors: `400` malformed UUID/pagination; `401` missing or invalid token; `403` missing permission or active teacher context; `404` missing patient/active matching period; `409` active patient/subject assignment already exists. Transaction failures roll back.

`GET /patient-assignments` and `/patient-assignments/mine` accept bounded `limit` (1–100, default 50) and nonnegative `offset` (default 0), returning `{ "items": [...], "limit", "offset" }`. Results include only patient `id`, `nombres`, `apellidos`, `documento` and assignment/period/context/audit metadata. They expose no contact or clinical fields and do not provide clinical-record access. Ended assignments and revoked student periods are excluded. T3 reassignment/end and T4 student revocation remain future work.

### POST /auth/register

Creates an `estudiante` account. Requires a Bearer token
(`Authorization: Bearer <token>`) whose role has `users:write` in the database.
The seeded admin role has this grant; see the first-admin bootstrap below.

- Body: `{ "username", "password", "email" }` — all required
- `201` → `{ "id", "username", "role": "estudiante", "email", "createdAt" }`
- `400` — validation failure (see [Validation rules](#validation-rules));
  `401` — missing/invalid token; `403` — missing `users:write` grant;
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
profile row in one transaction. Requires a Bearer token and `students:write`;
`created_by` records the acting user's verified token subject.

- Body: `{ "username", "password", "nombres", "apellidos", "codalumno", "email"?, "celular"? }`
- `201` → `{ "id", "nombres", "apellidos", "codalumno", "email", "celular", "created_by", "created_at" }`
- `400` — missing required field; `username` not A-Z0-9 (stored UPPERCASE);
  `password` under 10 chars or without a letter+digit; `codalumno` not purely
  alphanumeric (`^[A-Za-z0-9]+$`); `email` present but not a valid address;
  `401` — missing/invalid token; `403` — missing `students:write` grant;
  `409` — duplicate `codalumno`

```bash
curl.exe -X POST http://localhost:3000/students -H "Content-Type: application/json" -H "Authorization: Bearer <admin-token>" -d '{"username":"jperez","password":"secret12345","nombres":"Juan","apellidos":"Perez","codalumno":"20240123","email":"jperez@example.com"}'
```

### POST /teachers

Alta en uno: creates the access account (role `teacher`) and the `teachers`
profile row in one transaction. Requires a Bearer token and `teachers:write`;
`created_by` records the acting user's verified token subject.

- Body: `{ "username", "password", "nombres", "apellidos", "email"?, "celular"? }`
- `201` → `{ "id", "nombres", "apellidos", "email", "celular", "created_by", "created_at" }`
- `400` — missing required field; `username` not A-Z0-9 (stored UPPERCASE);
  `password` under 10 chars or without a letter+digit; `email` present but not
  a valid address; `401` — missing/invalid token; `403` — missing `teachers:write` grant

```bash
curl.exe -X POST http://localhost:3000/teachers -H "Content-Type: application/json" -H "Authorization: Bearer <admin-token>" -d '{"username":"mruiz","password":"secret12345","nombres":"Maria","apellidos":"Ruiz","email":"mruiz@example.com"}'
```

### POST /patients

Clinical entity only — no account is created. Requires a Bearer token and
`patients:write`; `created_by` records the acting user's verified token subject.

- Body: `{ "documento", "nombres", "apellidos", "fecha_nacimiento", "email", "celular", "sexo", "direccion" }` — all required
- `201` → `{ "id", "documento", "nombres", "apellidos", "fecha_nacimiento", "email", "celular", "sexo", "direccion", "created_by", "created_at" }`
- `400` — missing field; `documento` not 4-8 digits; `sexo` not `M` or `F`;
  `fecha_nacimiento` not a real `YYYY-MM-DD` date or in the future; `email`
  not a valid address; `401` — missing/invalid token;
  `403` — missing `patients:write` grant; `409` — duplicate `documento`

```bash
curl.exe -X POST http://localhost:3000/patients -H "Content-Type: application/json" -H "Authorization: Bearer <admin-token>" -d '{"documento":"12345678","nombres":"Ana","apellidos":"Lopez","fecha_nacimiento":"1990-05-10","email":"ana@example.com","celular":"+5491100000000","sexo":"F","direccion":"Av. Siempre Viva 123"}'
```

### POST /subjects

Creates a subject catalog entry. Requires a Bearer token whose database role
has `subjects:write`; client-supplied actor fields are ignored. Subject names
are trimmed nonblank strings, and duplicate names are allowed.

- Body: `{ "name" }` — required string; whitespace-only values are rejected
- `201` → `{ "id", "name", "created_by", "created_at" }`; `id` is a UUID,
  `created_by` is the verified token subject or `null`, and `created_at` is an
  ISO timestamp
- `400` — invalid name; `401` — missing/invalid token;
  `403` — missing `subjects:write` grant

### GET /subjects

Lists subjects for a role with `subjects:read` in the database. The read grant
is independent from the write grant.

- Query: `limit` defaults to `50` and accepts `1`–`100`; `offset` defaults to
  `0` and accepts `0`–`10000`. Values must be decimal digits only; repeated
  parameters, fractions and out-of-range values return `400`.
- `200` → `{ "items", "limit", "offset" }`; items are ordered by `name ASC`,
  then `id ASC`. There are no totals or filters.
- `400` — invalid pagination; `401` — missing/invalid token;
  `403` — missing `subjects:read` grant

No subject update or delete endpoints are provided. Subject/group associations
are a separate API from habilitations; creating a link does not enable teacher
or student access.

### POST /groups

Creates an academic group. Requires a Bearer token whose database role has
`groups:write`; client-supplied attribution is ignored and `created_by` records
the verified token subject or `null`.

- Body: `{ "academic_year", "curriculum_semester", "name" }` — both numbers
  must be positive JSON integers within PostgreSQL's 32-bit integer range;
  `name` is trimmed and must be nonblank. Semester has no curricular ceiling.
- `201` → `{ "id", "academic_year", "curriculum_semester", "name", "created_by", "created_at" }`;
  timestamps are ISO strings.
- `400` — invalid fields; `401` — missing/invalid token;
  `403` — missing `groups:write` grant; `409` — the `(academic_year,
  curriculum_semester, name)` tuple already exists. Group names are case-sensitive
  for this uniqueness rule.

### GET /groups

Lists groups for a role with `groups:read` in the database. Read and write
grants are independent; admin has no authorization bypass and other roles can
be explicitly delegated either permission.

- Query: `limit` defaults to `50` and accepts `1`–`100`; `offset` defaults to
  `0` and accepts `0`–`10000`. Values must be decimal digits only; repeated
  parameters, fractions and out-of-range values return `400`.
- `200` → `{ "items", "limit", "offset" }`; items are ordered by academic
  year, curriculum semester, name and ID ascending. No totals or filters.
- `401` — missing/invalid token; `403` — missing `groups:read` grant.

No group update or delete endpoints are provided.

### POST /subject-groups

Creates a subject-to-academic-group association. Requires a Bearer token whose
database role has `subject-groups:write`; the independently enforced permission
is initially granted only to admin and can be delegated to other roles. Admin
has no bypass. Client-supplied actor fields are ignored; `created_by` is the
verified token subject or `null`.

- Body: `{ "subject_id", "academic_group_id" }` — both values must be UUIDs.
- `201` → `{ "subject_id", "academic_group_id", "created_by", "created_at" }`;
  timestamps are ISO strings.
- `400` — malformed UUID or invalid request; `401` — missing/invalid token;
  `403` — missing `subject-groups:write` grant; `404` — a referenced subject or
  academic group does not exist; `409` — this subject/group pair is already linked.

### GET /subject-groups

Lists associations for a role with `subject-groups:read` in the database. This
permission is independent from `subject-groups:write`; admin has no bypass and
other roles can be delegated either grant separately.

- Optional `subject_id` must be one UUID string; repeated or malformed values
  return `400`. A valid subject with no links returns an empty page.
- `limit` defaults to `50` and accepts `1`–`100`; `offset` defaults to `0` and
  accepts `0`–`10000`. Values must be decimal digits only; repeated parameters,
  fractions and out-of-range values return `400`.
- `200` → `{ "items", "limit", "offset" }`; each item contains only
  `subject_id`, `academic_group_id`, `created_by`, and ISO `created_at`. Results
  are ordered by subject ID and academic-group ID ascending. There are no totals.
- `401` — missing/invalid token; `403` — missing `subject-groups:read` grant.

Associations establish academic context only. They do not create, revoke, or
otherwise alter teacher/student habilitations. Catalog prerequisites are
migration `009_create_academic_contexts.sql` and migration 013.

### Clinical record schema foundation

Migration `008_create_clinical_records.sql` adds one schema-only longitudinal
record per patient. Its internal key is `BIGINT GENERATED BY DEFAULT AS IDENTITY`
(an intentional exception to the existing UUID primary-key convention); preserve
BIGINT values as decimal strings at JavaScript/API boundaries. Patient and actor
references remain UUIDs. There is no record status, endpoint, clinical content,
or immutable event-audit claim; nullable `created_`/`updated_` columns follow the
existing actor-bookkeeping convention.

### Academic catalog schema foundation

Migration `009_create_academic_contexts.sql` adds subjects, academic groups and
an explicit many-to-many association. Groups are shared across subjects and
identified by academic year, curriculum semester and group name; curriculum
semester is not a calendar half-year. UUID identifiers follow the existing
user/catalog identity convention (the clinical-record BIGINT remains an
intentional table-specific exception). Required names are nonblank, year and
curriculum semester are positive, and linked catalogs cannot be deleted while
associations remain. Migration 009 itself is schema only: it adds no API,
permissions, habilitations or automatic expiry. Subject endpoints and their
independent permissions were added separately by the subject API slice.
Migration 009 was applied to an explicitly authorized disposable test database,
and all six focused academic integration tests passed. TypeScript checks and 24
selected DB-free unit tests also passed; the full regression suite was not run for
that slice. Group HTTP routes and their separately seeded permissions are added
by this API slice; migration `012_seed_group_permissions.sql` adds enforced,
independent `groups:write` and `groups:read` grants initially assigned only to
admin. Group creation/listing does not create subject/group associations or
habilitation records.

### Academic habilitation history

Migration `010_create_academic_habilitations.sql` stores separate teacher and
student habilitation periods. Each period records a required activation actor
and timestamp; revocation actor and timestamp are optional but must be supplied
together, and revocation cannot precede activation. Closing a period retains it;
reactivation inserts a new period. Only one unrevoked period per profile and
subject/group context is allowed. Contexts must exist in
`subject_academic_groups`, and profile, context and actor references restrict
deletes to preserve history.

These foreign keys prove that referenced rows exist, not that the actor was
authorized to activate or revoke access. Application authorization and any
teacher-to-student revocation cascade remain outside this persistence-only
schema; no cascade is inferred here.

### Teacher habilitation activation API

`POST /teacher-habilitations` is the activation-only first slice. Its fresh,
independently enforced `teacher-habilitations:write` permission is granted only
to `admin` by migration 014; admin has no bypass, and the grant can be
explicitly delegated through the permission matrix. Authorization reads fresh
role grants on every request. This permission enables only the activation
endpoint; it grants no clinical-record access.

- Body: `{ "teacher_id", "subject_id", "academic_group_id" }` — each value
  must be a UUID, and the subject/group pair must already be associated.
- `201` → `{ "id", "teacher_id", "subject_id", "academic_group_id",
  "activated_by", "activated_at", "revoked_by": null, "revoked_at": null }`.
  The verified token subject supplies `activated_by`; the database clock
  supplies `activated_at`. Client attribution and timestamp fields are ignored.
- `400` — invalid UUID or body; `401` — missing/invalid token or verified UUID
  actor; `403` — missing `teacher-habilitations:write` grant; `404` — teacher
  or subject/group context does not exist; `409` — an active period already
  exists for this teacher/context.

### POST /student-habilitations

Activates a new student habilitation period; it does not revoke periods, create
assignments, restore old assignments, or grant clinical-record access. The
fresh `student-habilitations:write` permission is seeded for the `teacher` role
by migration 016, but the grant alone is insufficient: the authenticated user
must resolve to a teacher profile with an active habilitation in the exact
subject/group context. Admin has no bypass. The verified user's UUID is stored
as `activated_by`; body-supplied actor fields are ignored. Existing period UUIDs
and the existing active-period unique index remain in force.

- Body: `{ "student_id", "subject_id", "academic_group_id" }` — each value
  must be a UUID; the student and linked subject/group context must exist.
- `201` → the stored period with `id`, `student_id`, `subject_id`,
  `academic_group_id`, `activated_by`, `activated_at`, `revoked_by: null`,
  and `revoked_at: null`.
- `400` — malformed UUID; `401` — missing/invalid token or actor; `403` —
  missing permission, teacher profile, or active teacher context; `404` —
  missing student or subject/group context; `409` — an active period already
  exists for this student/context.

### POST /teacher-habilitations/:id/revoke

Revokes only the selected teacher habilitation period. The separately enforced
`teacher-habilitations:revoke` permission is initially granted only to `admin`
by migration 015 and can be delegated through the fresh permission matrix;
`teacher-habilitations:write` does not authorize revocation, and admin has no
bypass. The verified UUID token subject supplies `revoked_by`, while the
database clock supplies `revoked_at`; client-supplied audit/context fields are
ignored. No request body is required.

- `200` → the stored period with the same eight fields as activation; timestamps
  are ISO strings. Repeating the operation returns the original revocation facts.
- `400` — malformed period UUID; `401` — missing/invalid token or verified UUID
  actor; `403` — missing `teacher-habilitations:revoke`; `404` — period not found;
  `500` — unexpected persistence failure, including an invalid revocation actor FK.

Revocation does not cascade to student periods, assignments, accounts, or
clinical documents. Reactivation creates a distinct new period through the
existing activation endpoint; retrying an old period cannot revoke it. Apply
migration `015_seed_teacher_habilitation_revocation_permission.sql` before
routing revocation. Existing migration 010 and migrations 014 are unchanged.
Listing, student habilitation management, assignment, and clinical recording
are not delivered.

The migration runner owns each migration's transaction and ledger entry; the
migration itself does not begin or commit transactions. Running integration
tests requires an explicitly authorized disposable database because shared
cleanup deletes application rows. No down migration is supplied:
any reversal requires a separately reviewed recovery plan, not routine table
drops.

### First admin bootstrap

Registration requires `users:write` and creates only `estudiante` accounts.
The first admin is created directly in the database by the bootstrap CLI (dev-only):

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
- Seeded roles: `estudiante`, `teacher`, `admin`. Login derives `permissions`
  from database grants. This claim is advisory: each authenticated request
  reloads grants for the token's role, ignoring even a stale or absent permissions
  claim. Grant changes take effect on the next request without token renewal.
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

## Permission-matrix deployment and rollback

These are prerequisites for a separately authorized deployment, not evidence
that migrations or database checks have been performed.

### Deploying

1. Confirm the target and preserve a recoverable database/policy backup and
   migration ledger. Review customized grants against the approved access policy.
2. Apply migrations through `015_seed_teacher_habilitation_revocation_permission.sql`
   before routing subject, group, association, or teacher-habilitation traffic.
   Migration `006` creates the permission tables, `007` seeds the original matrix,
   `009` creates academic catalog tables, and `011`–`015` add independent subject,
   group, association, activation, and revocation permissions with initial admin
   grants. The runner in
   `src/db/migrate.ts` commits each file and its ledger entry separately; a later
   migration can fail while earlier files remain committed. Keep new application
   traffic blocked until the required migrations are verified.
3. Verify the migration ledger through `014`, matrix readability by the
   application DB role, and expected role grants. A fresh untouched `007` seed
   alone has **7 permission rows and 13 grants**. After `011`, the canonical
   matrix has **9 permission rows and 15 grants**; after `012`, it has **11
   permission rows and 17 grants**; after `013`, it has **13 permission rows
   and 19 grants**; after `014`, it has **14 permission rows and 20 grants**;
   after `015`, it has **15 permission rows and 21 grants**.
   These are not universal counts for customized
   deployments. Verify authorized login and
   permission allow/deny scenarios; `GET /` is only a heartbeat and does not
   establish matrix health.

Migrations `007` and `011`–`015` use plain inserts and are **not idempotent**.
The ledger prevents normal replay; do not reset it, rerun any seed over existing
rows, or drop customized grants to recover from an error. Diagnose partial
application before retrying. Readable tables with no matching grant produce
`403` on permission-protected routes; a missing/unreadable matrix produces
`500`, not a role denial. `materias:read` does not grant subject access; the
subject read and write grants are independent and may be explicitly delegated
through database role grants.

### Rolling back

Stop the rollout and preserve matrix data and ledger entries. Deploy only an
application version verified compatible with the retained schema **and
approved policy**: reverting to token/static permissions may restore revoked
access. There is no automated down-migration in this runner. Any schema/data
reversal requires a separately reviewed backup/restore plan, not table drops.

## Testing

**Destructive:** integration cleanup deletes application records, truncates
`role_permissions` and `permissions`, then restores the matrix by replaying
`007` and `011`–`015`. The `pretest` hook also changes schema. Never run these
tests against a shared or valuable database.

The subjects integration test additionally requires
`SUBJECTS_TEST_ISOLATED=true` and the complete dedicated `SUBJECTS_TEST_*`
configuration (database URL, JWT secret, client URL, JWT key ID, token lifetime,
bcrypt cost and reset-token settings). Apply migrations `011`–`015`
beforehand; the test verifies all ledger entries and grants before invoking
destructive cleanup. Run it
only after explicit authorization and independent verification of a dedicated
disposable target. Cleanup is destructive even after the test assertions finish.

For the general suite, use `pnpm test` only after explicit authorization and
independent verification of a disposable target (unit + integration, serial,
with `.env.test`). The actual target is `DATABASE_URL`, not a guaranteed database
named `saludback_test`. Supply all required configuration (`DATABASE_URL`,
`JWT_SECRET`, `CLIENT_URL`): `src/config.ts` attempts to load `.env` when any of
these is missing. For a static-only check without starting the application, use
`pnpm exec tsc --noEmit`. All database test runs require explicit authorization
and independent target verification; this README provides no database command.
