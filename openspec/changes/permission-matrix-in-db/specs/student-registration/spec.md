# Delta for Student Registration

## MODIFIED Requirements

### Requirement: STU-005: Admin-Only Guard and Actor Resolution

`POST /students` MUST require a verified Bearer token holding the `students:write` permission (token verified by `authenticate`, policy enforced by `PermissionGuard(students:write)`). A missing, malformed, or expired token MUST respond 401 and the handler MUST NOT run; a verified token without `students:write` MUST respond 403. The `admin` role owns `students:write` via its seeded `role_permissions` grants, so admin access is unchanged. `created_by` MUST be the verified token subject (`req.auth` `sub`/`userId`) on both the account row and the `students` row.
(Previously: cited `ROLE_PERMISSIONS` as the source of the admin `students:write` grant; the grant now comes from the seeded database matrix.)

#### Scenario: Missing token rejected

- GIVEN no Authorization header
- WHEN an unauthenticated client calls `POST /students`
- THEN the response is 401 `UNAUTHORIZED`
- AND nothing is persisted

#### Scenario: Token without students:write rejected

- GIVEN a verified Bearer token whose `permissions` do not include `students:write`
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

#### Scenario: Admin token still accepted

- GIVEN a verified `admin` token and a valid payload
- WHEN `POST /students` is called with it
- THEN the response is 201
- AND exactly one user and one `students` row are persisted