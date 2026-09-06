# User Authentication Specification

## Purpose

Username + password login. On success the system issues a token carrying `role` and `permissions` claims so post-login access to profile, materias, turnos, and any role-permitted resource can be gated from day one. Failed logins return a generic 401 to avoid user enumeration.

## Requirements

### Requirement: Login with Credentials

The system MUST accept `POST /auth/login` with `username` and `password`. Valid credentials MUST return HTTP 200 with an access token. Invalid credentials (unknown username or wrong password) MUST return HTTP 401 with a generic error that does not reveal whether the username exists. Missing or empty fields MUST return HTTP 400.

#### Scenario: Successful login

- GIVEN a registered user with valid credentials
- WHEN the client calls `POST /auth/login` with the correct `username` and `password`
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

The access token MUST carry a `role` claim and a `permissions` claim. For `estudiante` users, the `role` claim SHALL be `estudiante` and `permissions` SHALL be derived from the role. The token MUST NOT carry the password hash or other secrets.

#### Scenario: Token carries role and permissions

- GIVEN a successful login as an `estudiante`
- WHEN the returned token is decoded
- THEN the `role` claim equals `estudiante`
- AND the `permissions` claim is a non-empty array derived from the role

### Requirement: Token Verification

The system MUST provide token-verification middleware that authenticates requests and exposes the decoded `role` and `permissions` on the request. Requests with a missing, malformed, expired, or invalid token MUST be rejected with 401.

#### Scenario: Valid token passes

- GIVEN a valid, unexpired token from a successful login
- WHEN a protected request is made with that token
- THEN the request proceeds
- AND `role` and `permissions` are available to the request handler

#### Scenario: Missing or invalid token

- GIVEN no token, or a malformed or expired token
- WHEN a protected request is made
- THEN the system responds 401
- AND the request handler is not executed
