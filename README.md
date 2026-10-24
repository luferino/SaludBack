# SaludBack

Health-domain backend API. Node.js 24 + Express 5 + PostgreSQL, structured as
modular Clean Architecture (`src/modules/<module>/{domain,application,infrastructure}`).

## Application composition

`src/app.ts` remains the `createApp(pool)` entry point and composition root. It
configures global JSON parsing, the heartbeat, explicit area mounts and the final
error handler. Construction and mounting are separated under `src/bootstrap/`:

- `create-dependencies.ts` builds one app-local dependency graph with manually
  injected repositories and services. JWT, permission-matrix reader, user
  repository, hasher and unit of work retain their shared instances where needed;
  separate `createApp` calls do not share global singleton instances.
- `routes/auth.routes.ts` keeps authentication entry-point exceptions explicit.
- `routes/profiles.routes.ts` mounts patients, students and teachers.
- `routes/academic.routes.ts` mounts subjects, groups, linked contexts and
  habilitations. Its separate teacher-habilitation mount preserves the original
  registration order after clinical routes.
- `routes/clinical.routes.ts` mounts assignments and kinesiology evaluations.

Mounts keep authentication before protected handlers and retain each existing
permission guard. No DI container, automatic route registry or HTTP contract
change is introduced.

Run composition regressions without database migrations:

```sh
node --import tsx --test tests/unit/app-composition.test.js
```

The clinical differential test is historical evidence for two fixed Git revisions:
its loader reads the entire source snapshot, including app composition, from Git
in memory. It does not require the live source tree to remain at the old revision.
The ordinary unit suite, including composition and module wiring tests, exercises
the current application.

## Clinical module architecture

`kinesiology-evaluations` and `patient-assignments` follow the same inward dependency
rule as the other layered modules:

| Layer | Responsibility |
| --- | --- |
| `domain` | Clinical content/date rules, submission completeness, assignment state policies and domain types |
| `application` | Transport-independent service entry points and repository ports; incoming clinical content validation |
| `infrastructure/routes` | Express parsing, permission guards, verified actors and response serialization |
| `infrastructure/repositories` | PostgreSQL queries, projections, ordered locks and atomic port operations |
| `index.ts` | Compatibility exports used by the composition root in `src/app.ts` |

Repository ports describe **atomic contextual operations**, not independent CRUD
steps. PostgreSQL adapters must check live authorization and invoke state-dependent
policies inside the same transaction, at their existing lock positions. In
particular, submission completeness is checked against the locked evaluation;
assignment ended-state is not disclosed before source/destination authorization.
The adapters still orchestrate those transaction-sensitive workflows; the services
must not replace them with unlocked preflight checks. No HTTP contract, permission,
schema, lock ordering or transaction boundary changes are part of this extraction.

Run the database-free architecture and focused regression checks directly (not
`pnpm test`, whose lifecycle runs database migrations):

```sh
node --import tsx --test --test-concurrency=1 tests/unit/clinical-architecture.test.js tests/unit/clinical-application.test.js tests/unit/kinesiology-evaluation-drafts.test.js tests/unit/patient-assignments.test.js tests/unit/patient-assignment-lifecycle.test.js
pnpm exec tsc --noEmit
```

These synthetic checks do not establish live PostgreSQL concurrency behavior.

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
| `GET` | `/students` | minimal paginated student selector — Bearer token + `students:read` |
| `POST` | `/teachers` | account + teacher profile — Bearer token + `teachers:write` |
| `GET` | `/teachers` | minimal paginated teacher selector — Bearer token + `teachers:read` |
| `POST` | `/patients` | patient record (no account) — Bearer token + `patients:write` |
| `POST` | `/subjects` | create subject — Bearer token + `subjects:write` |
| `GET` | `/subjects` | list subjects — Bearer token + `subjects:read` |
| `POST` | `/groups` | create academic group — Bearer token + `groups:write` |
| `GET` | `/groups` | list academic groups — Bearer token + `groups:read` |
| `POST` | `/subject-groups` | associate a subject and academic group — Bearer token + `subject-groups:write` |
| `GET` | `/subject-groups` | list subject/group associations — Bearer token + `subject-groups:read` |
| `GET` | `/teacher-habilitations` | paginated teacher periods — Bearer token + `teacher-habilitations:read` |
| `POST` | `/teacher-habilitations` | activate teacher in a linked subject/group context — Bearer token + `teacher-habilitations:write` |
| `POST` | `/teacher-habilitations/:id/revoke` | revoke one teacher habilitation period — Bearer token + `teacher-habilitations:revoke` |
| `GET` | `/student-habilitations` | paginated student periods — Bearer token + `student-habilitations:read`; non-admins require live teacher context |
| `POST` | `/student-habilitations` | activate a student in an authorized subject/group context — Bearer token + `student-habilitations:write` |
| `POST` | `/student-habilitations/:id/revoke` | revoke one student period and atomically close its active assignments — Bearer token + `student-habilitations:revoke` + active teacher context |
| `POST` | `/patient-assignments` | assign a patient to an active student period — `patient-assignments:write` + active teacher context |
| `GET` | `/patient-assignments` | list assignments in active teacher contexts — `patient-assignments:read` |
| `GET` | `/patient-assignments/mine` | list own assignments — `patient-assignments:read-own` |
| `POST` | `/kinesiology-evaluations` | create an initial-evaluation draft — `kinesiology-evaluations:write` + current own assignment |
| `PATCH` | `/kinesiology-evaluations/:id` | edit own accessible draft — `kinesiology-evaluations:write` |
| `GET` | `/kinesiology-evaluations/:id` | read a draft in live author/origin-teacher context, or a submitted snapshot with current patient-care access — `kinesiology-evaluations:read` |
| `GET` | `/kinesiology-evaluations/:id/consent` | read the latest paper-consent attestation only in live author/origin-teacher context — `kinesiology-evaluations:read` |
| `POST` | `/kinesiology-evaluations/:id/consent` | origin teacher records paper date and verifies in one operation — `kinesiology-evaluations:verify-consent` |
| `GET` | `/kinesiology-evaluations?patient_id=<uuid>` | list drafts in live author/origin-teacher context and submitted snapshots with current patient-care access — `kinesiology-evaluations:read` |
| `GET` | `/kinesiology-evaluations/:id/submissions` | read submission history in live origin context, or only the latest snapshot with current patient-care access — `kinesiology-evaluations:read` |
| `POST` | `/kinesiology-evaluations/:id/submissions` | freeze and submit the current own draft — `kinesiology-evaluations:submit` + current own assignment |
| `POST` | `/kinesiology-evaluations/:id/corrections` | origin teacher requests corrections to the latest submitted version — `kinesiology-evaluations:review` |
| `POST` | `/kinesiology-evaluations/:id/validations` | origin teacher validates the latest submitted version — `kinesiology-evaluations:review` |
| `POST` | `/kinesiology-evaluations/:id/amendments` | create a separately authored amendment from a validated evaluation — `kinesiology-evaluations:write` + current own assignment |
| `GET` | `/kinesiology-evaluations/:id/corrections` | read correction reasons/reviewer/time in live origin context — `kinesiology-evaluations:read` |

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

`GET /patient-assignments` and `/patient-assignments/mine` accept bounded `limit` (1–100, default 50) and nonnegative `offset` (default 0), returning `{ "items": [...], "limit", "offset" }`. Results include only patient `id`, `nombres`, `apellidos`, `documento` and assignment/period/context/audit metadata. They expose no contact or clinical fields and do not provide clinical-record access. Ended assignments and revoked student periods are excluded.

`POST /patient-assignments/:id/reassign` accepts `{ "student_habilitation_id", "subject_id", "academic_group_id" }` and returns `200` with the replacement assignment. `id` is a positive BIGINT decimal string. The actor must have `patient-assignments:write` and active teacher contexts for both source and destination groups in the same subject; the destination period must be active and match that subject/group. The old row is closed with server-owned actor/time and null `end_reason`, and the replacement row is inserted atomically. Errors include `400` malformed ID/UUID or cross-subject request, `401` missing/invalid authentication, `403` missing permission/context, `404` missing assignment/active destination period, and `409` ended source or active-assignment uniqueness conflict.

`POST /patient-assignments/:id/end` requires `{ "end_reason": "..." }` and returns `200` with the closed assignment. The reason must be a string containing non-whitespace and is persisted trimmed; actor and timestamp are server-owned. Missing, null, non-string, or blank reasons return `400` with `end_reason must be a non-empty string`, without changing state. Already-ended assignments return `409` and retain their original end facts. Both lifecycle routes require the fresh `patient-assignments:write` grant and an active teacher context. They lock teacher contexts, student periods, patient, then assignment and revalidate inside one transaction. Automatic closure during reassignment or student revocation does not require a user reason. T4 student revocation remains future work.

### Initial kinesiology evaluation drafts (T1)

Drafts use `/kinesiology-evaluations`. `POST` accepts `{ "patient_id": "<UUID>", "subject_id": "<UUID>", "academic_group_id": "<UUID>", "content": { ... } }`; the active period/assignment, author and audit fields are derived from the verified student and current database context. Identity and audit fields are never accepted from the body. `content` is an object with optional strings/nulls `admission_date`, `admission_status`, `illness_history`, `medical_diagnosis`, `kinesiology_diagnosis`, `objectives`, `proposed_treatment`, `occupation`, and `referring_physician`; optional `antecedents` maps the form labels `hta`, `dbt`, `diu`, `sedentary_lifestyle`, and `pacemaker` to true/false/null (unknown remains null), plus optional `other`; `studies` is an optional array of `{ "type", "description", "date"? }`. Drafts may be empty or incomplete. Identity is read from the current patient record; only the author with current origin membership and assignment can edit. Invalid/missing actors return `401`; missing write permission and visible-but-noneditable origin-context teacher PATCHes return `403`. A foreign draft that is not visible in the actor's live origin context returns the same `404` as an unknown draft, without disclosing its existence. Origin-context teachers can read but not rewrite. Create, detail, and list responses expose the current patient as `patient` with only `id`, `documento`, `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo`, and `direccion` (never patient audit fields). `age` is calculated at `content.admission_date`, and is `null` while admission is pending. Reads require a patient filter; administrative patient creation and reads do not create clinical history. The first draft atomically creates or reuses `clinical_records` under the patient lock. BIGINT identifiers are decimal strings. Paper consent is a separate endpoint and does not change draft JSON: `GET /kinesiology-evaluations/:id/consent` returns `{ "evaluation_id", "status": "pending" | "verified", "evidence" }` for actors already allowed to read the draft; pending evidence is `null`. The origin-context teacher with the fresh `kinesiology-evaluations:verify-consent` grant uses `POST` on the same path with exactly `{ "paper_signature_date": "YYYY-MM-DD" }`. A successful verification returns `201`. Missing operation permission returns `403`; with that permission but no active origin-teacher context, the endpoint returns the same `404` and `evaluation was not found` as a nonexistent evaluation, including after context revocation. The paper date and verification are recorded together; verifier identity comes from the authenticated UUID actor and verification time from the database clock. Each successful call appends immutable evidence with a lossless BIGINT ID, date, verifier, teacher-context period and server time; it does not rewrite draft content or audit facts. A later verification is another evidence row, not an overwrite. This attests to a signed paper document; it is not a digital signature or treatment authorization.

`POST /kinesiology-evaluations/:id/submissions` accepts exactly `{}` and requires the fresh `kinesiology-evaluations:submit` grant plus the draft author's current student profile, origin membership and own active patient assignment. Submission requires a valid `admission_date` and nonblank `illness_history`, `admission_status`, `objectives`, and `proposed_treatment`; diagnoses, occupation, referring physician, and studies remain optional. The latest verified teacher paper-consent evidence is required. Success returns `201` with a lossless BIGINT `id`, `evaluation_id`, decimal-string `ordinal`, server-owned `submitted_by`/`submitted_at`, `status: "pending_validation"`, and frozen `clinical_content`, `studies`, safe patient `patient` snapshot, `age_at_admission`, and verified `consent` evidence. The evaluation detail changes to `status: "submitted"` and `validation_status: "pending_validation"`; PATCH and repeat submission return `409`. Invalid content/body returns `400`, missing submit permission `403`, and private/unavailable evaluation `404`. `GET /kinesiology-evaluations/:id/submissions` returns `{ "evaluation_id", "items" }` in the live author/origin-teacher context. Other students can read a submitted snapshot only with their own linked profile, active membership, and current patient assignment; teachers need an active habilitation in a subject/group with that patient's active assignment and active student period in the same exact context. Cross-context detail/list/history show only the latest immutable submission, including its frozen clinical content, studies, demographics, age and consent evidence, pending-validation label, and server submission provenance. They never show a working correction or current patient/attestation data. Drafts without a submission remain private. Cross-context access does not enable edits, review, or consent reads; `GET /:id/consent` remains origin-only. Revoking current care access removes cross-context visibility but does not erase submissions. Origin readers retain their existing draft and full-history behavior. Reads do not create clinical history. Teacher correction requests and validation are described below.

Submission-history reads preserve `404` with `evaluation was not found` for missing or inaccessible evaluations. An accessible origin-context draft with no submissions returns `200` with an empty `items` array. Missing fresh read permission returns `403` before clinical context lookup, including for administrators.

### Teacher correction requests (T3A)

`POST /kinesiology-evaluations/:id/corrections` accepts exactly `{ "submission_id": "<positive BIGINT decimal string>", "reason": "<nonblank string>" }` and returns `201` with the draft status and server-recorded request ID/time. The reason is trimmed; reviewer identity comes from the verified UUID actor. A fresh `kinesiology-evaluations:review` grant and active teacher context for the evaluation's exact origin subject/group are required. Hidden or missing evaluations return the same `404`; missing grants return `403` before a transaction. Malformed bodies, blank reasons, and invalid/overflow IDs return `400`; foreign submissions return `404`; stale versions, already-open correction requests, or evaluations not submitted return `409`.

The request targets only the latest submitted version. It atomically records an immutable reason/reviewer/time event and reopens a working draft copied from that exact snapshot. The original submission, studies, demographics, consent evidence, and authorship remain unchanged. `GET /kinesiology-evaluations/:id/corrections` returns `{ evaluation_id, items }` with recorded submission IDs, reasons, reviewer UUIDs, and request times only for live author/origin-teacher readers with a fresh read grant. Cross-context detail/list/history continue to show only the latest submitted snapshot, never correction content or reasons. The original author may edit/resubmit only while their linked profile, origin membership, and own current assignment remain active; reassignment does not restore access automatically. Resubmission creates the next ordinal snapshot and reuses existing verified consent evidence.

`POST /kinesiology-evaluations/:id/validations` accepts exactly `{ "submission_id": "<positive BIGINT decimal string>" }`. The fresh `kinesiology-evaluations:review` grant and a live teacher profile/context for the evaluation's exact origin subject/group are required. A successful `201` records the authenticated reviewer, active teacher-context period and database review time, and marks the evaluation validated without changing its submitted clinical snapshot. Only the latest submission can be targeted. Missing/private evaluations return `404`; a foreign submission returns `404`; a stale version or non-awaiting evaluation returns `409`; malformed IDs or extra body keys return `400`; missing grants return `403`. Repeated reviews cannot alter existing state. Validated evaluations cannot be edited or accepted for another review. Pending and validated labels are reported without exposing review/correction records across care contexts.

T3A implements correction requests and resubmission; T3B implements validation. T4 amendments are separate evaluations explicitly linked to an immutable validated original. `POST /kinesiology-evaluations/:id/amendments` accepts exactly `{}` and requires a live student profile, active origin period, and the actor's own current assignment for that patient's origin context. The original must already be validated; the new draft copies its last reviewed submission snapshot, not mutable authoring state, and records its server-owned author/link identity. Amendment creation cannot replace or edit the original, and original authorship is not required. The amendment's ordinary submit/correction/review/validation workflow creates its own snapshots and reviews. The verified consent evidence from the original validated snapshot is reused at amendment submission; no new consent gate is introduced. Amendment details expose `amendment_of_evaluation_id`; submitted versions retain their own evaluation/submission IDs and review facts. Hidden, unvalidated, inaccessible, or mismatched parent records do not create an amendment.

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

### GET /teachers and GET /students

Use these selectors to obtain **profile UUIDs** for habilitation requests; do not
use the account UUID from authentication. Both require a valid Bearer token and
an exact, fresh read grant. Write grants never authorize a GET, and admin has no
permission bypass.

| Endpoint | Exact item fields | Initial read grants (migration 027) |
|----------|-------------------|------------------------------------|
| `/teachers` | `id`, `nombres`, `apellidos` | `teachers:read`: admin |
| `/students` | `id`, `nombres`, `apellidos`, `codalumno` | `students:read`: admin, teacher |

The student selector is deliberately global and includes students not yet
habilitated, so a teacher can select them for activation. It does not grant
access to their accounts, clinical information or other academic contexts.
Neither selector returns `user_id`, passwords/hashes, contact or audit fields.
Permissions can be explicitly delegated through `role_permissions`.

- Query: `limit` (default 50, range 1–100), `offset` (default 0, range 0–10000).
  Each must be a single decimal-digit string; empty, repeated, signed, fractional
  and out-of-range values return `400`.
- `200` → `{ "items": [...], "limit": 50, "offset": 0 }`; no total count.
  Ordered by `apellidos`, `nombres`, then profile `id`, ascending. An empty page
  is `200` with `items: []`.
- Errors: `400 BAD_REQUEST` for invalid pagination; `401 UNAUTHORIZED` for missing
  or invalid authentication; `403 FORBIDDEN` for a missing exact read grant;
  unexpected failures are `500 INTERNAL_SERVER_ERROR` with no database details.
  Error shape: `{ "error": { "code": "FORBIDDEN", "message": "..." } }`.

```bash
curl.exe "http://localhost:3000/students?limit=20&offset=0" -H "Authorization: Bearer <teacher-token>"
curl.exe "http://localhost:3000/teachers?limit=20&offset=0" -H "Authorization: Bearer <admin-token>"
```

For example, `/students` returns:

```json
{"items":[{"id":"10000000-0000-4000-8000-000000000021","nombres":"Ana","apellidos":"Perez","codalumno":"A1"}],"limit":50,"offset":0}
```

Pass that `id` as `student_id` (or a teacher selector's `id` as `teacher_id`).

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

### GET /teacher-habilitations and GET /student-habilitations

These read-only lists expose active and revoked **periods**, not accounts or
clinical records. Migration 028 seeds independent enforced read permissions:

| Endpoint | Required fresh permission | Initial grants and scope |
|----------|---------------------------|--------------------------|
| `/teacher-habilitations` | `teacher-habilitations:read` | admin: global history |
| `/student-habilitations` | `student-habilitations:read` | admin: global history; teacher: only currently active teacher contexts |

Admin must also have the exact read grant; `:write` and `:revoke` never imply
`:read`. Teachers receive neither `teachers:read` nor `teacher-habilitations:read`
by default. A deliberately delegated read grant is evaluated independently.
Non-admin student-period readers must have a teacher profile linked to the
verified account and a live teacher habilitation. Their visible rows are scoped
by the exact subject/group pairs **before pagination**, regardless of which
teacher originally activated a student. Revoking a teacher's context removes
access on subsequent reads, including historical student periods in that context.
No student self-read capability is granted by these endpoints.

| Query parameter | Contract |
|-----------------|----------|
| `teacher_id` / `student_id` | Optional profile UUID; use the parameter matching the endpoint |
| `subject_id` | Optional subject UUID |
| `academic_group_id` | Optional academic group UUID |
| `status` | Optional `active` (`revoked_at IS NULL`) or `revoked` (`revoked_at IS NOT NULL`); omit for both |
| `limit`, `offset` | Same defaults, single decimal-digit validation and bounds as the profile selectors: 50/0, 1–100/0–10000 |

Supplied UUIDs must be single hyphenated hexadecimal UUID strings. Filters are
combined with AND. Explicit subject/group filters outside a non-admin reader's
active contexts return `403`; a partial subject or group filter must match at
least one active context. Without context filters, only authorized contexts are
listed; lacking any active teacher context returns `403`. Valid unknown profile
IDs yield empty lists, not existence-probing `404` responses.

`200` returns `{ "items": [...], "limit": 50, "offset": 0 }`, ordered by
`activated_at DESC, id DESC`, with no count. Exact teacher-period item:

```json
{
  "id": "10000000-0000-4000-8000-000000000051",
  "teacher_id": "10000000-0000-4000-8000-000000000011",
  "subject_id": "10000000-0000-4000-8000-000000000031",
  "academic_group_id": "10000000-0000-4000-8000-000000000041",
  "activated_by": "10000000-0000-4000-8000-000000000001",
  "activated_at": "2026-01-01T00:00:00.000Z",
  "revoked_by": null,
  "revoked_at": null
}
```

Student items have the same keys except `student_id` replaces `teacher_id`.
`id` identifies the historical **period**; `teacher_id`/`student_id` identify
**profiles**, while `activated_by`/`revoked_by` identify actor **accounts**.
Timestamps are ISO 8601 UTC; revoked periods have non-null revocation actor/time.
Resolve context names through `/subjects` and `/groups` with their own read grants.
No passwords, account profile links, contact or clinical fields are returned.

Errors use `{ "error": { "code", "message" } }`: `400 BAD_REQUEST` for malformed
filters or pagination, `401 UNAUTHORIZED` for invalid/missing authentication,
`403 FORBIDDEN` for missing read permission or teacher scope, and generic
`500 INTERNAL_SERVER_ERROR` without SQL details. Empty authorized results are
`200`, not `404`.

```bash
curl.exe "http://localhost:3000/teacher-habilitations?status=active&limit=20" -H "Authorization: Bearer <admin-token>"
curl.exe "http://localhost:3000/student-habilitations?subject_id=<subject-uuid>&academic_group_id=<group-uuid>&status=revoked" -H "Authorization: Bearer <teacher-token>"
```

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

### POST /student-habilitations/:id/revoke

Revokes only the selected student period and atomically ends its active patient
assignments without a user-supplied reason. The separately enforced
`student-habilitations:revoke` permission is initially granted to `teacher` by
migration 019; activation's `student-habilitations:write` permission is not
sufficient. The authenticated actor must also have an active teacher
habilitation in that period's subject/group. Admin has no bypass. Repeated
revocation returns the original period audit facts and does not rewrite ended
assignment history. Later activation creates a new period and never restores
assignments attached to the revoked period.

- `200` → the stored period with activation and original revocation audit facts.
- `400` — malformed period UUID; `401` — missing/invalid token or verified UUID
  actor; `403` — missing `student-habilitations:revoke` or active teacher context;
  `404` — period not found after contextual authorization.

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
`pnpm exec tsc --noEmit`. The destructive database suites require explicit
authorization and independent target verification.

The academic read-listing tests have a separate, non-destructive path:

```bash
node --import tsx --test tests/unit/profile-listings.test.js tests/unit/habilitation-listings.test.js tests/unit/academic-read-permission-seed.test.js
node --import tsx --env-file=.env.test --test tests/integration/academic-read-listings.test.js
```

The latter requires the complete test configuration and a PostgreSQL connection
allowed to create a schema. It creates a unique schema inside one transaction,
sets a schema-only search path, loads its own fixtures, drives the four HTTP GETs,
and rolls back the entire schema in `finally`. It does not run the migration
runner, truncate shared tables, or use the existing destructive cleanup. Tests
cover exact response keys/profile identities, deterministic paging, all period
filters, active/revoked history, independent grants, fresh grant/context
revocation, cross-context denial, and unchanged public data after rejected reads.
The unit suites also preserve existing POST/activation/revocation behavior.
