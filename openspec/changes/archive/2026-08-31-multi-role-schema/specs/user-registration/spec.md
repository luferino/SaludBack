# Delta for User Registration

## MODIFIED Requirements

### Requirement: Register Student Account

The system MUST accept `POST /auth/register` with a `username` and `password` and MUST create a user with role `estudiante` and `created_by` NULL. The request MUST fail with HTTP 409 when the username already exists, and MUST fail with HTTP 400 when `username` or `password` is missing or empty. Registering a user MUST NOT create a `students` row; student profiles are created only through the student-registration flow.
(Previously: no audit or profile-side-effect rules were pinned.)

#### Scenario: Successful registration

- GIVEN a valid `username` and `password` and no existing user with that username
- WHEN a client calls `POST /auth/register`
- THEN the system responds 201 Created
- AND a user with role `estudiante` is persisted

#### Scenario: Duplicate username

- GIVEN an existing user with username `jperez`
- WHEN a client calls `POST /auth/register` with username `jperez`
- THEN the system responds 409 Conflict
- AND no new user is created

#### Scenario: Empty or missing fields

- GIVEN a request with an empty `username` or an empty or missing `password`
- WHEN the client calls `POST /auth/register`
- THEN the system responds 400 Bad Request
- AND no user is created

#### Scenario: Registration is account-only

- GIVEN a successful registration
- WHEN the database is inspected
- THEN the new user has `created_by` NULL
- AND no `students` row references the new user