# Teacher Registration Specification

## Purpose

Staff-originated creation of teachers via `POST /teachers`: one request provides the access account (`user`, role `teacher`) and the `teachers` profile row, reusing the student-registration create-or-link semantics. The route is admin-only: a verified `admin` Bearer token is required and the acting admin is recorded in `created_by` on both the account and the profile row.

## Requirements

### Requirement: TEA-001: Create Teacher

`POST /teachers` MUST accept `username`, `password`, `nombres`, `apellidos` (required) and optional `email`, `celular`. It MUST create the access account (role `teacher`, hashed password) and the `teachers` row (`user_id` FK to `users.id`) together, with audit columns per the audit-trail convention. The account `username` and `password` follow the shared auth validation used by user-registration: `username` is required, may contain only letters and digits (A-Z0-9), and is normalized to uppercase for storage and lookup; `password` is required, at least 10 characters, with at least one letter and one digit. Unlike register, `email` stays optional — when present it MUST match the same standard email format. Success MUST respond 201; a missing or empty required field MUST respond 400 and persist nothing.

#### Scenario: Successful creation

- GIVEN a valid payload and no existing user with that `username` or `email`
- WHEN `POST /teachers` is called
- THEN the response is 201
- AND exactly one user (role `teacher`) and one `teachers` row are persisted
- AND the row's `user_id` equals the new user's id

#### Scenario: Missing required field

- GIVEN a payload without `apellidos`
- WHEN `POST /teachers` is called
- THEN the response is 400
- AND no user or `teachers` row is persisted

### Requirement: TEA-002: Create-or-Link Existing Account

When a user already exists with the same `username` OR the same `email` as the payload, the system MUST link the teacher to that user (`user_id` = existing id) instead of creating a duplicate account. The existing user's credentials and role MUST NOT be modified. Success MUST still respond 201.

#### Scenario: Link by username

- GIVEN an existing user with username `mruiz`
- WHEN `POST /teachers` is called with that `username`
- THEN no new user is created
- AND the `teachers` row links to the existing user
- AND the existing user's role is unchanged

#### Scenario: No match creates account

- GIVEN no existing user matches the payload `username` or `email`
- WHEN `POST /teachers` is called
- THEN a new user is created and linked

### Requirement: TEA-003: Response Contract

The response MUST contain exactly `id`, `nombres`, `apellidos`, `email`, `celular`, `created_by`, `created_at` and no other field — no `user_id`, no `username`/`password`, no `updated_by`/`updated_at`. `created_by` SHALL equal the acting admin's id (the route is admin-only).

#### Scenario: Only contract fields

- GIVEN a successful admin-authorized create
- WHEN the response body is inspected
- THEN the body matches the contract fields
- AND `created_by` is the admin's id

### Requirement: TEA-004: Admin-Only Guard and Actor Resolution

`POST /teachers` MUST require a verified `admin` Bearer token (token verified by `authenticate`, policy enforced by `AdminGuard`). A missing, malformed, or expired token MUST respond 401 and the handler MUST NOT run; a verified non-admin token MUST respond 403. `created_by` MUST be the verified token subject (`req.auth` `sub`/`userId`) on both the account row and the `teachers` row.
(Previously: the seam was default-open and `created_by` fell back to NULL for anonymous or invalid tokens.)

#### Scenario: Missing token rejected

- GIVEN no Authorization header
- WHEN an unauthenticated client calls `POST /teachers`
- THEN the response is 401 `UNAUTHORIZED`
- AND nothing is persisted

#### Scenario: Non-admin token rejected

- GIVEN a verified Bearer token whose role is not `admin`
- WHEN a client calls `POST /teachers` with it
- THEN the response is 403 `FORBIDDEN`
- AND nothing is persisted

#### Scenario: Actor from verified token

- GIVEN a valid admin token with `sub` `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`
- WHEN `POST /teachers` is called
- THEN the teacher's `created_by` is that id
- AND the created user's `created_by` is that id

## Non-Goals

- Teacher update/profile endpoints, self-registration, role mutation on link, and login changes.