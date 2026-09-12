# User Accounts Specification

## Purpose

Account identity invariants for the auth domain: every NEW registration carries a valid, unique email; legacy rows without email keep `NULL`; password recovery is denied for accounts without email (flow in the password-recovery spec); the user store gains find-by-email and password-update capabilities.

## Requirements

### Requirement: Email required for new registrations

The system MUST require a non-empty, syntactically valid `email` on `POST /auth/register` alongside `username` and `password`. A missing, empty, or malformed email MUST fail with HTTP 400; an email already in use MUST fail with HTTP 409, mirroring the duplicate-username rule. The email MUST be persisted on the user record.

#### Scenario: Successful registration with email

- GIVEN a valid `username`, `password`, and `email` with no existing user using that username or email
- WHEN a client calls `POST /auth/register`
- THEN the system responds 201 Created
- AND the user is persisted with the provided email

#### Scenario: Missing or malformed email

- GIVEN an empty, missing, or malformed `email` (e.g. no `@`)
- WHEN a client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Duplicate email

- GIVEN an existing user with email `dup@example.com`
- WHEN a client calls `POST /auth/register` with that same email
- THEN the system responds 409 Conflict
- AND no user is created

### Requirement: Legacy users keep NULL email

The `003_*` migration MUST add a nullable `email` column to `users` and MUST be purely additive. Pre-existing rows MUST keep `email = NULL`; the column MUST NOT be backfilled (no join key links `users` to `patients`). Every registration after the migration MUST write a non-NULL email.

#### Scenario: Existing rows untouched

- GIVEN users created before migration `003_*` is applied
- WHEN the migration is applied
- THEN every pre-existing row still has `email = NULL`
- AND no data backfill runs as part of the migration

### Requirement: Recovery denied without email

The system MUST NOT issue a password-reset token for a user whose `email` is NULL. The denial MUST be indistinguishable from every other forgot-password outcome, so a missing email never leaks through the API.

#### Scenario: User without email requests recovery

- GIVEN a user with `email = NULL` and a non-empty `username`
- WHEN `POST /auth/forgot-password` is called with that username
- THEN the response is the same generic success body as an unknown username
- AND no reset token is created and no email is sent

### Requirement: User lookup and password update capabilities

The user store MUST expose `findByEmail(email)` and `updatePassword(userId, newPasswordHash)`. `updatePassword` MUST replace the stored hash so the previous password stops working immediately. New hashes MUST be bcrypt with the configured cost (default 12), consistent with registration.

#### Scenario: Find by email

- GIVEN a user with email `x@example.com`
- WHEN the store is queried with that email
- THEN the matching user is returned
- AND null is returned for an unknown email

#### Scenario: Password replaced

- GIVEN a user with an existing password hash
- WHEN `updatePassword` stores a new hash
- THEN login with the old password fails
- AND login with the new password succeeds

### Requirement: User Audit Columns (Internal)

The `users` table MUST gain nullable `created_by`, `updated_by`, and `updated_at` columns per the audit-trail convention, while keeping `id` as a UUID primary key (no bigserial). Registration MUST record the authenticated admin's id in `created_by` (register is admin-only; the token `sub` is resolved at route level). The audit columns MUST NOT appear in the user entity `toJSON` or any API response; the existing user response contract MUST stay unchanged.
(Previously: registration recorded `created_by` NULL because no admin flow existed.)

#### Scenario: Registration records the acting admin

- GIVEN a successful `POST /auth/register` by an authenticated admin
- WHEN the persisted user row is inspected
- THEN `created_by` equals the admin's id
- AND `updated_by` and `updated_at` are both NULL

#### Scenario: Response hides audit columns

- GIVEN any persisted user
- WHEN the entity is serialized
- THEN `toJSON` contains no `created_by`, `updated_by`, or `updated_at` keys

### Requirement: Account Email Optional in Profile Flows

Accounts created by the student- and teacher-registration flows (alta en uno) MAY have `email` NULL; the mandatory-email rule applies to `POST /auth/register` only. When the payload provides an email, it MUST be syntactically valid (malformed MUST respond 400 and persist nothing) and, if it already belongs to an existing user, that account SHALL be linked per the create-or-link rules instead of rejected as a duplicate.

#### Scenario: Email-less student account

- GIVEN a `POST /students` payload without `email`
- WHEN the alta en uno flow runs
- THEN the created user has `email` NULL

#### Scenario: Malformed email rejected

- GIVEN a `POST /teachers` payload with email `not-an-email`
- WHEN the alta en uno flow runs
- THEN the response is 400
- AND no user or teacher is persisted
