# Delta for Teacher Registration

## MODIFIED Requirements

### Requirement: TEA-004: Admin-Only Guard and Actor Resolution

`POST /teachers` MUST require a verified Bearer token holding the `teachers:write` permission (token verified by `authenticate`, policy enforced by `PermissionGuard(teachers:write)`). A missing, malformed, or expired token MUST respond 401 and the handler MUST NOT run; a verified token without `teachers:write` MUST respond 403. The `admin` role owns `teachers:write` via its seeded `role_permissions` grants, so admin access is unchanged. `created_by` MUST be the verified token subject (`req.auth` `sub`/`userId`) on both the account row and the `teachers` row.
(Previously: cited `ROLE_PERMISSIONS` as the source of the admin `teachers:write` grant; the grant now comes from the seeded database matrix.)

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