# Delta for User Registration

## MODIFIED Requirements

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