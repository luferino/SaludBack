# Delta for User Authentication

## MODIFIED Requirements

### Requirement: Token Claims Contract

The access token MUST carry a `role` claim, a `permissions` claim, and a `sub` claim equal to the authenticated user's id. For `estudiante` users the `role` claim SHALL be `estudiante`; for `teacher` users it SHALL be `teacher`; `permissions` SHALL be derived from the role via `ROLE_PERMISSIONS`. The token MUST NOT carry the password hash or other secrets.
(Previously: only `role` and `permissions` claims were pinned; `sub` and the `teacher` role were unspecified.)

#### Scenario: Token carries role and permissions

- GIVEN a successful login as an `estudiante`
- WHEN the returned token is decoded
- THEN the `role` claim equals `estudiante`
- AND the `permissions` claim is a non-empty array derived from the role

#### Scenario: Token carries subject id

- GIVEN a successful login
- WHEN the returned token is decoded
- THEN the `sub` claim equals the authenticated user's id

#### Scenario: Teacher token claims

- GIVEN a successful login as a `teacher`
- WHEN the returned token is decoded
- THEN the `role` claim equals `teacher`
- AND `permissions` are derived from the `teacher` entry in `ROLE_PERMISSIONS`

### Requirement: Token Verification

The system MUST provide token-verification middleware that authenticates requests and exposes the decoded `role`, `permissions`, and verified subject on the request. The subject SHALL be exposed as both `req.auth.sub` and `req.auth.userId`; when the token carries no `sub` claim, both MUST be absent. Requests with a missing, malformed, expired, or invalid token MUST be rejected with 401.
(Previously: middleware exposed only `role` and `permissions`; the verified subject was dropped — the PAT-004 gap.)

#### Scenario: Valid token passes

- GIVEN a valid, unexpired token from a successful login
- WHEN a protected request is made with that token
- THEN the request proceeds
- AND `role`, `permissions`, and `sub`/`userId` are available on `req.auth`

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