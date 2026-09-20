# User Registration Specification

## Purpose

Admin-originated creation of `estudiante` accounts. There is no self-registration: accounts are created on behalf of students. The endpoint is admin-only: a verified Bearer token holding the `users:write` permission (owned by the admin role) is required, and the acting admin is recorded in `created_by`. The first admin is born through the create-admin bootstrap script, not through the API.

## Requirements

### Requirement: Register Student Account

The system MUST accept `POST /auth/register` with a `username`, `password`, and `email` and MUST create a user with role `estudiante`, recording the authenticated admin's id in `created_by`. The input contract: `username` is required and MUST contain only letters and digits (A-Z0-9), normalized to uppercase for storage and lookup; `password` is required, MUST be at least 10 characters, and MUST contain at least one letter and one digit; `email` is required and MUST match a standard email format. The request MUST fail with HTTP 409 when the username already exists or the email is already in use, including when the duplicate is caught by the unique index (SQLSTATE 23505 MUST be translated to 409 CONFLICT, never a raw database error), and MUST fail with HTTP 400 when a field is missing, empty, or fails its format rule. Registering a user MUST NOT create a `students` row; student profiles are created only through the student-registration flow.
(Previously: registration wrote `created_by` NULL because no admin flow existed and the 23505 race on the unique index was unpinned.)

#### Scenario: Successful registration

- GIVEN a valid `username`, `password`, and `email` and no existing user with that username or email
- WHEN a client calls `POST /auth/register`
- THEN the system responds 201 Created
- AND a user with role `estudiante` is persisted

#### Scenario: Duplicate username

- GIVEN an existing user with username `jperez`
- WHEN a client calls `POST /auth/register` with username `jperez`
- THEN the system responds 409 Conflict
- AND no new user is created

#### Scenario: Empty or missing fields

- GIVEN a request with an empty `username` or an empty or missing `password` or `email`
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Username with invalid characters

- GIVEN a request with a `username` containing characters other than letters and digits (e.g. `j.perez`)
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Username stored uppercase

- GIVEN a successful registration with username `jperez`
- WHEN the persisted user record is inspected
- THEN the stored username is `JPEREZ`

#### Scenario: Password too short

- GIVEN a request with a valid `username` and a `password` shorter than 10 characters
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Password without a digit

- GIVEN a request with a valid `username` and a `password` containing letters but no digit
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Password without a letter

- GIVEN a request with a valid `username` and a `password` containing digits but no letter
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Malformed email

- GIVEN a request with a valid `username` and `password` but a malformed `email`
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Duplicate email

- GIVEN an existing user with email `jperez@example.com`
- WHEN the client calls `POST /auth/register` with a different `username` and the same `email`
- THEN the system responds 409 Conflict
- AND no new user is created

#### Scenario: Registration is account-only

- GIVEN a successful registration
- WHEN the database is inspected
- THEN the new user records the acting admin's id in `created_by`
- AND `updated_by` and `updated_at` are NULL
- AND no `students` row references the new user

### Requirement: Password Hashing

The system MUST NOT persist plaintext passwords. It SHALL store a bcrypt hash of the password (with a configurable cost factor) and MUST NOT return or log the raw password.

#### Scenario: Plaintext never persisted

- GIVEN a successful registration with password `secret12345`
- WHEN the persisted user record is inspected
- THEN the stored password value is a bcrypt hash
- AND the hash does not equal `secret12345`

### Requirement: Admin-Only Registration

`POST /auth/register` MUST require a verified Bearer token holding the `users:write` permission (token verified by `authenticate`, policy enforced by `PermissionGuard(users:write)`). A missing, malformed, or expired token MUST respond 401 with `UNAUTHORIZED` and the message `Invalid or missing token` (the token is verified before any handler runs); a verified token without `users:write` MUST respond 403 with `FORBIDDEN`; in both cases the registration use case MUST NOT execute and nothing MUST be persisted. The `admin` role owns `users:write` via `ROLE_PERMISSIONS`, so admin-performed registration is unchanged. The first admin cannot be created through this API — it SHALL be bootstrapped via the create-admin script (`pnpm create-admin`), which enforces the same username/password rules and inserts a single `admin` user directly against the database.
(Previously: the gate required the token's `role` claim to be `admin`, enforced by `AdminGuard`.)

#### Scenario: No token rejected

- GIVEN no Authorization header
- WHEN an unauthenticated client calls `POST /auth/register`
- THEN the request is rejected with 401 and `UNAUTHORIZED`
- AND the registration use case is not executed

#### Scenario: Expired token rejected

- GIVEN an expired Bearer token
- WHEN a client calls `POST /auth/register` with it
- THEN the request is rejected with 401, `UNAUTHORIZED`, and the message `Invalid or missing token`
- AND the registration use case is not executed

#### Scenario: Token without users:write rejected

- GIVEN a verified Bearer token whose `permissions` do not include `users:write`
- WHEN a client calls `POST /auth/register` with it
- THEN the request is rejected with 403 and `FORBIDDEN`
- AND the registration use case is not executed

#### Scenario: Admin token still accepted

- GIVEN a verified `admin` token and a valid registration payload
- WHEN a client calls `POST /auth/register` with it
- THEN the response is 201 Created
- AND a user with role `estudiante` is persisted
