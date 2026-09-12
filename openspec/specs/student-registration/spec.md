# Student Registration Specification

## Purpose

Staff-originated "alta en uno" creation of students via `POST /students`: one request creates the access account (`user`, role `estudiante`) and the `students` profile row together, or links the student to an existing account. The route is admin-only: a verified `admin` Bearer token is required and the acting admin is recorded in `created_by` on both the account and the profile row.

## Requirements

### Requirement: STU-001: Create Student (Alta en Uno)

`POST /students` MUST accept `username`, `password`, `nombres`, `apellidos`, `codalumno` (required) and optional `email`, `celular`. It MUST create the access account (role `estudiante`, hashed password) and the `students` row (`user_id` FK to `users.id`) in one operation, with audit columns per the audit-trail convention. The account `username` and `password` follow the shared auth validation used by user-registration: `username` is required, may contain only letters and digits (A-Z0-9), and is normalized to uppercase for storage and lookup; `password` is required, at least 10 characters, with at least one letter and one digit. Unlike register, `email` stays optional — when present it MUST match the same standard email format. Success MUST respond 201; a missing or empty required field MUST respond 400 and persist nothing.

#### Scenario: Successful alta en uno

- GIVEN a valid payload and no existing user with that `username` or `email`
- WHEN `POST /students` is called
- THEN the response is 201
- AND exactly one user (role `estudiante`) and one `students` row are persisted
- AND the row's `user_id` equals the new user's id

#### Scenario: Missing required field

- GIVEN a payload without `codalumno`
- WHEN `POST /students` is called
- THEN the response is 400
- AND no user or `students` row is persisted

### Requirement: STU-002: Create-or-Link Existing Account

When a user already exists with the same `username` OR the same `email` as the payload, the system MUST link the student to that user (`user_id` = existing id) instead of creating a duplicate account. The existing user's credentials and role MUST NOT be modified. Success MUST still respond 201.

#### Scenario: Link by username

- GIVEN an existing user with username `jperez`
- WHEN `POST /students` is called with that `username`
- THEN no new user is created
- AND the `students` row links to the existing user
- AND the existing user's role is unchanged

#### Scenario: Link by email

- GIVEN an existing user whose email matches the payload, with a different username
- WHEN `POST /students` is called
- THEN the `students` row links to that existing user
- AND no duplicate user is created

#### Scenario: No match creates account

- GIVEN no existing user matches the payload `username` or `email`
- WHEN `POST /students` is called
- THEN a new user is created and linked

### Requirement: STU-003: codalumno Rules

`codalumno` MUST be required, unique across ALL students (global scope, case-insensitive), and match a PURE alphanumeric format: only ASCII letters and digits, with no hyphens, dots, slashes, spaces or other separators (e.g. `20240123`, `ABC123`). A duplicate MUST respond 409; an invalid format MUST respond 400; neither persists anything.

#### Scenario: Duplicate codalumno

- GIVEN an existing student with `codalumno` `20240123`
- WHEN `POST /students` is called with the same value or a different-casing variant
- THEN the response is 409
- AND nothing is persisted

#### Scenario: Invalid format

- GIVEN a payload with `codalumno` `12_34A`
- WHEN `POST /students` is called
- THEN the response is 400
- AND nothing is persisted

### Requirement: STU-004: Response Contract

The response MUST contain exactly `id`, `nombres`, `apellidos`, `codalumno`, `email`, `celular`, `created_by`, `created_at` and no other field — no `user_id`, no `username`/`password`, no `updated_by`/`updated_at`. `created_by` SHALL equal the acting admin's id (the route is admin-only).

#### Scenario: Only contract fields

- GIVEN a successful admin-authorized create
- WHEN the response body is inspected
- THEN the body matches the contract fields
- AND `created_by` is the admin's id

### Requirement: STU-005: Admin-Only Guard and Actor Resolution

`POST /students` MUST require a verified `admin` Bearer token (token verified by `authenticate`, policy enforced by `AdminGuard`). A missing, malformed, or expired token MUST respond 401 and the handler MUST NOT run; a verified non-admin token MUST respond 403. `created_by` MUST be the verified token subject (`req.auth` `sub`/`userId`) on both the account row and the `students` row.
(Previously: the seam was default-open and `created_by` fell back to NULL for anonymous or invalid tokens.)

#### Scenario: Missing token rejected

- GIVEN no Authorization header
- WHEN an unauthenticated client calls `POST /students`
- THEN the response is 401 `UNAUTHORIZED`
- AND nothing is persisted

#### Scenario: Non-admin token rejected

- GIVEN a verified Bearer token whose role is not `admin`
- WHEN a client calls `POST /students` with it
- THEN the response is 403 `FORBIDDEN`
- AND nothing is persisted

#### Scenario: Actor from verified token

- GIVEN a valid admin token with `sub` `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`
- WHEN `POST /students` is called
- THEN the student's `created_by` is that id
- AND the created user's `created_by` is that id

#### Scenario: Expired token rejected

- GIVEN an expired Bearer token
- WHEN `POST /students` is called with it
- THEN the response is 401 with the message `Invalid or missing token`
- AND nothing is persisted

## Non-Goals

- Student update/profile endpoints, self-registration, and login changes.