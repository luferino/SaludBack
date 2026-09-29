# Delta for User Authentication

## MODIFIED Requirements

### Requirement: Token Claims Contract

The access token MUST carry a `role` claim, a `permissions` claim, and a `sub` claim equal to the authenticated user's id. For `estudiante` users the `role` claim SHALL be `estudiante`; for `teacher` users it SHALL be `teacher`. The `permissions` claim SHALL be derived from the role at sign-in via the `PermissionMatrixReader` port (`permissionsForRole`), reading the `role_permissions` grants in the database. The claim is ADVISORY — `authenticate` ignores it, recomputing permissions per request. The token MUST NOT carry the password hash or other secrets. The token header MUST carry a `kid` (key id) identifying the signing secret (default `"current"`, configurable via `JWT_SECRET_KID`) — `kid` is a HEADER field, not a claim.
(Previously: `permissions` came from the hardcoded `ROLE_PERMISSIONS` constant and `authenticate` treated a present claim as authoritative.)

#### Scenario: Token carries role and permissions

- GIVEN a successful login as an `estudiante`
- WHEN the returned token is decoded
- THEN the `role` claim equals `estudiante`
- AND the `permissions` claim is a non-empty array matching the role's `role_permissions` grants

#### Scenario: Token carries subject id

- GIVEN a successful login
- WHEN the returned token is decoded
- THEN the `sub` claim equals the authenticated user's id

#### Scenario: Teacher token claims

- GIVEN a successful login as a `teacher`
- WHEN the returned token is decoded
- THEN the `role` claim equals `teacher`
- AND the `permissions` claim mirrors the `teacher` grants in `role_permissions`

#### Scenario: Fresh login reflects matrix changes

- GIVEN a new grant is added to `role_permissions`
- WHEN a user of that role logs in after the change
- THEN the token's `permissions` claim includes the new grant

### Requirement: Token Verification

The system MUST provide token-verification middleware that authenticates requests and exposes the verified `role` and subject together with the request's permissions. The subject SHALL be exposed as both `req.auth.sub` and `req.auth.userId`; when the token carries no `sub` claim, both MUST be absent. The middleware MUST resolve `req.auth.permissions` from the permission matrix on every request via `permissionsForRole(role)`, MUST ignore the token's `permissions` claim, and MUST NOT backfill from any code constant. Requests with a missing, malformed, expired, or invalid token MUST be rejected with 401.
(Previously: the middleware copied the token's `permissions` claim when present and backfilled from `permissionsForRole(role)` only when the claim was missing.)

#### Scenario: Valid token passes

- GIVEN a valid, unexpired token from a successful login
- WHEN a protected request is made with that token
- THEN the request proceeds
- AND `role`, matrix-derived `permissions`, and `sub`/`userId` are on `req.auth`

#### Scenario: Missing or invalid token

- GIVEN no token, or a malformed or expired token
- WHEN a protected request is made
- THEN the system responds 401
- AND the request handler is not executed

#### Scenario: Token without subject claim

- GIVEN a valid token that carries no `sub` claim
- WHEN a protected request is made
- THEN the request proceeds
- AND `req.auth.sub` and `req.auth.userId` are undefined

#### Scenario: Claim is advisory

- GIVEN a valid token claiming a permission the role lacks in `role_permissions`
- WHEN a protected request is made with that token
- THEN `req.auth.permissions` excludes the claimed permission
- AND a guard requiring it responds 403

#### Scenario: Grant removal revokes on the next request

- GIVEN a token minted while the role held a grant in `role_permissions`
- AND the grant is removed
- WHEN a protected request is made with the same, still valid, token
- THEN `req.auth.permissions` no longer includes it
- AND a guard requiring it responds 403

#### Scenario: Matrix read failure fails closed

- GIVEN the permission matrix is unavailable (e.g. database error)
- WHEN a protected request is made with a valid token
- THEN the request is rejected
- AND the protected handler does not run