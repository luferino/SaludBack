# Password Recovery Specification

## Purpose

Self-service password reset via email link: `POST /auth/forgot-password` mails a single-use, expiring reset link through a `MailerPort` seam; `POST /auth/reset-password` consumes the token and replaces the password hash. Every forgot-password outcome returns an identical generic response (anti-enumeration; login's generic-401 precedent). Console transport this slice; SMTP and `express-rate-limit` out of scope.

## Requirements

### Requirement: Forgot-password request

`POST /auth/forgot-password` MUST accept a `username` (empty/missing → HTTP 400). Any non-empty username MUST return the same generic HTTP 200 body whether the user has an email, lacks one, or does not exist. A user with an email MUST get a token and a MailerPort-delivered link.

#### Scenario: User with email

- GIVEN user `jperez` with a non-NULL email
- WHEN forgot-password sends `username: jperez`
- THEN the system responds 200
- AND a token is stored and a reset link is mailed

#### Scenario: Unknown username

- GIVEN no user with the given username
- WHEN forgot-password is called
- THEN the body is identical to the user-with-email case
- AND no token is stored and no mail is sent

#### Scenario: User without email

- GIVEN a user whose `email` is NULL
- WHEN forgot-password is called
- THEN the body is identical to the unknown-username case
- AND no token is stored and no mail is sent

### Requirement: Reset token lifecycle

Reset tokens MUST be random, stored at rest only as `sha256` hashes, short-lived (`RESET_TOKEN_TTL`, default 15 minutes), and single-use. Outstanding unexpired tokens per user MUST be capped at a small fixed limit; issuing beyond it MUST invalidate the oldest.

#### Scenario: Hash at rest

- GIVEN a token issued for a user
- WHEN the tokens table is inspected
- THEN the stored value is the sha256 hash, never the raw token

#### Scenario: Per-user cap enforced

- GIVEN a user at the outstanding-token cap
- WHEN a new token is issued for that user
- THEN the oldest outstanding token is invalidated

### Requirement: Reset link target

The reset link MUST be `{CLIENT_URL}?token={token}`; the API MUST NOT host a reset page. `CLIENT_URL` MUST be configured; boot fails without it.

#### Scenario: Link shape

- GIVEN `CLIENT_URL=https://app.example.com/reset`
- WHEN a reset token is mailed
- THEN the mail contains `https://app.example.com/reset?token=<raw token>`

### Requirement: Reset password

`POST /auth/reset-password` MUST accept `token` and `newPassword` (empty/missing → HTTP 400). Unknown, expired, or used tokens MUST be rejected with a generic error without changing the password. Success MUST persist a bcrypt hash (cost default 12) and mark the token used.

#### Scenario: Valid reset

- GIVEN a valid, unexpired, unused token
- WHEN reset-password sends token + new password
- THEN the system responds 200
- AND the new hash is persisted, the old login fails, and the token is marked used

#### Scenario: Invalid token

- GIVEN an unknown, expired, or used token
- WHEN reset-password sends it
- THEN the system rejects with a generic error
- AND the password is unchanged

### Requirement: Mailer port seam

Delivery MUST go through a `MailerPort` seam with a console/dev transport this slice; swapping transports MUST NOT change the use case. SMTP is a non-goal.

#### Scenario: Delivery through the port

- GIVEN a forgot-password request for a user with an email
- WHEN the request use case runs
- THEN it calls the port with the recipient email and reset link
- AND the console transport prints the link to stdout

### Requirement: Existing sessions unaffected by reset

Auth uses stateless JWTs with no session store or denylist, so the system MUST NOT invalidate access tokens after a reset; they stay valid until expiry. Token-version invalidation is a future consideration.

#### Scenario: Pre-reset token still valid

- GIVEN an access token issued before the reset
- WHEN it hits a protected route after the reset
- THEN it is still accepted; no invalidation mechanism exists
