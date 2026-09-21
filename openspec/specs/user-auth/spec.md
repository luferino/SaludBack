# User Authentication Specification

## Purpose

Username + password login. On success the system issues a token carrying `role` and `permissions` claims so post-login access to profile, materias, turnos, and any role-permitted resource can be gated from day one. Failed logins return a generic 401 to avoid user enumeration.

## Requirements

### Requirement: Login with Credentials

The system MUST accept `POST /auth/login` with `username` and `password`. The username lookup MUST normalize to uppercase, so login with `jperez` finds a user stored as `JPEREZ`. Valid credentials MUST return HTTP 200 with an access token. Invalid credentials (unknown username or wrong password) MUST return HTTP 401 with a generic error that does not reveal whether the username exists. Missing or empty fields MUST return HTTP 400.

#### Scenario: Successful login

- GIVEN a registered user with valid credentials
- WHEN the client calls `POST /auth/login` with the correct `username` and `password`
- THEN the system responds 200 with an access token

#### Scenario: Username normalized to uppercase

- GIVEN a registered user with stored username `JPEREZ`
- WHEN the client calls `POST /auth/login` with username `jperez` and the correct password
- THEN the system responds 200 with an access token

#### Scenario: Unknown username

- GIVEN no user with username `ghost`
- WHEN the client calls `POST /auth/login` with username `ghost` and any password
- THEN the system responds 401
- AND the response body is identical to the wrong-password case

#### Scenario: Wrong password

- GIVEN a registered user and a wrong password
- WHEN the client calls `POST /auth/login` with the correct `username`
- THEN the system responds 401 with the same generic error as the unknown-username case

#### Scenario: Missing fields

- GIVEN a request with an empty or missing `username` or `password`
- WHEN the client calls `POST /auth/login`
- THEN the system responds 400 Bad Request

### Requirement: Token Claims Contract

The access token MUST carry a `role` claim, a `permissions` claim, and a `sub` claim equal to the authenticated user's id. For `estudiante` users the `role` claim SHALL be `estudiante`; for `teacher` users it SHALL be `teacher`; `permissions` SHALL be derived from the role via the seeded `role_permissions` table. The token MUST NOT carry the password hash or other secrets. In addition, the token header MUST carry a `kid` (key id) identifying the signing secret (default `"current"`, configurable via `JWT_SECRET_KID`) — `kid` is a HEADER field, not a claim.
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
- AND `permissions` are derived from the `teacher` entry in the seeded `role_permissions` table

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

### Requirement: Token Key Identification (Rotation Support)

Signed tokens MUST carry a `kid` header identifying the signing secret. Verification MUST accept the current secret and any configured previous secrets (`JWT_PREVIOUS_SECRETS`, a JSON array of `{"kid", "secret"}`), selecting the secret by the token's `kid`. Legacy tokens WITHOUT a `kid` header MUST verify against the current secret. Tokens whose `kid` matches neither the configured `JWT_SECRET_KID` nor any entry in `JWT_PREVIOUS_SECRETS` MUST be rejected. New tokens MUST be signed with the current secret.

#### Scenario: Token carries kid header

- GIVEN a successful login
- WHEN the returned token header is inspected
- THEN the header carries a `kid` field
- AND the `kid` equals the configured `JWT_SECRET_KID` (default `current`)

#### Scenario: Previous secret verifies by kid

- GIVEN a token signed with a previous secret whose `kid` is listed in `JWT_PREVIOUS_SECRETS`
- WHEN the token is verified
- THEN verification succeeds

#### Scenario: Legacy token without kid

- GIVEN a token signed with the current secret that carries no `kid` header
- WHEN the token is verified
- THEN verification succeeds against the current secret

#### Scenario: Unknown kid rejected

- GIVEN a token whose `kid` is neither the configured `JWT_SECRET_KID` nor any entry in `JWT_PREVIOUS_SECRETS`
- WHEN the token is verified
- THEN verification fails
- AND the request is rejected with 401
