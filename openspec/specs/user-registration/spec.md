# User Registration Specification

## Purpose

Admin-originated creation of `estudiante` accounts. There is no self-registration: accounts are created on behalf of students. The endpoint is open today because no admin role exists yet, but it MUST expose a guard seam so an admin-only guard can be attached later without rework.

## Requirements

### Requirement: Register Student Account

The system MUST accept `POST /auth/register` with a `username`, `password`, and `email` and MUST create a user with role `estudiante` and `created_by` NULL. The input contract: `username` is required and MUST contain only letters and digits (A-Z0-9), normalized to uppercase for storage and lookup; `password` is required, MUST be at least 10 characters, and MUST contain at least one letter and one digit; `email` is required and MUST match a standard email format. The request MUST fail with HTTP 409 when the username already exists or the email is already in use, and MUST fail with HTTP 400 when a field is missing, empty, or fails its format rule. Registering a user MUST NOT create a `students` row; student profiles are created only through the student-registration flow.
(Previously: no audit or profile-side-effect rules were pinned; the input contract and email-duplicate 409 were unspecified.)

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
- THEN the new user has `created_by` NULL
- AND no `students` row references the new user

### Requirement: Password Hashing

The system MUST NOT persist plaintext passwords. It SHALL store a bcrypt hash of the password (with a configurable cost factor) and MUST NOT return or log the raw password.

#### Scenario: Plaintext never persisted

- GIVEN a successful registration with password `secret12345`
- WHEN the persisted user record is inspected
- THEN the stored password value is a bcrypt hash
- AND the hash does not equal `secret12345`

### Requirement: Admin Guard Seam

The registration flow MUST expose a guard seam — a single policy boundary in front of the use case. While no admin role exists, the seam MUST allow unauthenticated requests (default open). When a guard policy is attached to the seam, the system SHALL enforce it before executing the use case.

#### Scenario: Seam open by default

- GIVEN no admin guard policy attached to the seam
- WHEN an unauthenticated client calls `POST /auth/register`
- THEN the registration use case executes normally

#### Scenario: Seam rejects when policy attached

- GIVEN an admin-only guard policy attached to the seam
- WHEN an unauthenticated client calls `POST /auth/register`
- THEN the request is rejected with 401 or 403
- AND the registration use case is not executed
