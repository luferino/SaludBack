# User Registration Specification

## Purpose

Admin-originated creation of `estudiante` accounts. There is no self-registration: accounts are created on behalf of students. The endpoint is open today because no admin role exists yet, but it MUST expose a guard seam so an admin-only guard can be attached later without rework.

## Requirements

### Requirement: Register Student Account

The system MUST accept `POST /auth/register` with a `username` and `password` and MUST create a user with role `estudiante`. The request MUST fail with HTTP 409 when the username already exists, and MUST fail with HTTP 400 when `username` or `password` is missing or empty.

#### Scenario: Successful registration

- GIVEN a valid `username` and `password` and no existing user with that username
- WHEN a client calls `POST /auth/register`
- THEN the system responds 201 Created
- AND a user with role `estudiante` is persisted

#### Scenario: Duplicate username

- GIVEN an existing user with username `jperez`
- WHEN a client calls `POST /auth/register` with username `jperez`
- THEN the system responds 409 Conflict
- AND no new user is created

#### Scenario: Empty or missing fields

- GIVEN a request with an empty `username` or an empty or missing `password`
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

### Requirement: Password Hashing

The system MUST NOT persist plaintext passwords. It SHALL store a bcrypt hash of the password (with a configurable cost factor) and MUST NOT return or log the raw password.

#### Scenario: Plaintext never persisted

- GIVEN a successful registration with password `secret123`
- WHEN the persisted user record is inspected
- THEN the stored password value is a bcrypt hash
- AND the hash does not equal `secret123`

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
