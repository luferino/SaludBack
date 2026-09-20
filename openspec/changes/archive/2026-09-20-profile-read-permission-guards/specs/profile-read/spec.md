# Profile Read Specification

## Purpose

First read endpoint in the codebase. `GET /auth/me` returns the authenticated account's own `username`, `email`, and `role`, read fresh from the database by the token's verified subject — never from JWT claims. Enforced through the `profile:read` permission, granted to every role by `ROLE_PERMISSIONS`.

## Requirements

### Requirement: PR-001: Get Current Account

`GET /auth/me` MUST require a verified Bearer token and MUST load the user row from the database by primary key using the token's `userId`. The response MUST be built from that fresh database row and MUST NOT be derived from JWT claims. A valid request MUST respond 200 with a body containing exactly three fields: `username`, `email`, `role`. The body MUST NOT include profile data (student/teacher/patient fields), `sub`, `permissions`, password hash, audit fields, or any other key. Accounts without a linked profile (e.g. a bootstrapped `admin`) MUST still respond 200 with the three user fields and nothing else.

#### Scenario: Happy path

- GIVEN a valid Bearer token for an existing user
- WHEN `GET /auth/me` is called
- THEN the response is 200
- AND the body contains exactly `username`, `email`, and `role`

#### Scenario: Fresh database read, not token claims

- GIVEN a token issued while the user's stored `email` was `old@example.com`
- AND the stored `email` has since changed to `new@example.com`
- WHEN `GET /auth/me` is called with that token
- THEN the response body shows `new@example.com`

#### Scenario: Account without a profile

- GIVEN a valid token for an account with no `students`, `teachers`, or `patients` row (e.g. the bootstrapped `admin`)
- WHEN `GET /auth/me` is called
- THEN the response is 200 with exactly `username`, `email`, and `role`
- AND no profile payload is included

### Requirement: PR-002: Rejection Contract

A missing, malformed, expired, or otherwise invalid token MUST respond 401 `UNAUTHORIZED` with the message `Invalid or missing token`, and the read MUST NOT execute. A verified token whose `permissions` do not include `profile:read` MUST respond 403 `FORBIDDEN`. A verified token whose `userId` matches no user row MUST respond 401 `UNAUTHORIZED` (the identity is no longer valid).

#### Scenario: No token rejected

- GIVEN no Authorization header
- WHEN `GET /auth/me` is called
- THEN the response is 401 `UNAUTHORIZED`
- AND the read does not execute

#### Scenario: Missing permission rejected

- GIVEN a verified Bearer token whose `permissions` do not include `profile:read`
- WHEN `GET /auth/me` is called with it
- THEN the response is 403 `FORBIDDEN`

#### Scenario: Unknown subject rejected

- GIVEN a verified token whose `userId` matches no user row
- WHEN `GET /auth/me` is called with it
- THEN the response is 401 `UNAUTHORIZED`