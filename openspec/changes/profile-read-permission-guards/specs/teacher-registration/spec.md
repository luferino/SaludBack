# Delta for Teacher Registration

## MODIFIED Requirements

### Requirement: TEA-004: Admin-Only Guard and Actor Resolution

`POST /teachers` MUST require a verified Bearer token holding the `teachers:write` permission (token verified by `authenticate`, policy enforced by `PermissionGuard(teachers:write)`). A missing, malformed, or expired token MUST respond 401 and the handler MUST NOT run; a verified token without `teachers:write` MUST respond 403. The `admin` role owns `teachers:write` via `ROLE_PERMISSIONS`, so admin access is unchanged. `created_by` MUST be the verified token subject (`req.auth` `sub`/`userId`) on both the account row and the `teachers` row.
(Previously: the policy was enforced by `AdminGuard` — any verified token whose role was not `admin` was rejected with 403.)

#### Scenario: Missing token rejected

- GIVEN no Authorization header
- WHEN an unauthenticated client calls `POST /teachers`
- THEN the response is 401 `UNAUTHORIZED`
- AND nothing is persisted

#### Scenario: Token without teachers:write rejected

- GIVEN a verified Bearer token whose `permissions` do not include `teachers:write`
- WHEN a client calls `POST /teachers` with it
- THEN the response is 403 `FORBIDDEN`
- AND nothing is persisted

#### Scenario: Actor from verified token

- GIVEN a valid admin token with `sub` `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`
- WHEN `POST /teachers` is called
- THEN the teacher's `created_by` is that id
- AND the created user's `created_by` is that id

#### Scenario: Admin token still accepted

- GIVEN a verified `admin` token and a valid payload
- WHEN `POST /teachers` is called with it
- THEN the response is 201
- AND exactly one user and one `teachers` row are persisted

## ADDED Requirements

### Requirement: TEA-005: One Profile Per Account

The system MUST enforce at most one `teachers` row per account: the `teachers.user_id` column MUST be UNIQUE. A database migration MUST add this constraint and MUST first run a pre-migration duplicate check over existing rows. When duplicates exist (rows sharing a `user_id`), the migration MUST abort BEFORE applying any DDL, MUST fail loudly listing every affected `user_id` (with its `teachers.id`), and MUST NOT repair, merge, or delete data automatically. When no duplicates exist, the migration MUST apply the constraint.

#### Scenario: Clean data migrates

- GIVEN no existing `teachers` rows share a `user_id`
- WHEN the migration pre-check runs
- THEN the migration proceeds
- AND a UNIQUE constraint on `teachers.user_id` is applied

#### Scenario: Duplicates abort the migration

- GIVEN two existing `teachers` rows with the same `user_id`
- WHEN the migration pre-check runs
- THEN the migration aborts before any DDL
- AND the failure lists the affected `user_id`
- AND no row is merged or deleted automatically

#### Scenario: Second profile impossible

- GIVEN a user already linked to a `teachers` row
- WHEN an insert attempts a second `teachers` row for the same `user_id`
- THEN the database rejects the insert on the unique constraint
- AND no second row exists