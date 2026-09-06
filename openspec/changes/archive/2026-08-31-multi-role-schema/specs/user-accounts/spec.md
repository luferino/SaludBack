# Delta for User Accounts

## ADDED Requirements

### Requirement: User Audit Columns (Internal)

The `users` table MUST gain nullable `created_by`, `updated_by`, and `updated_at` columns per the audit-trail convention, while keeping `id` as a UUID primary key (no bigserial). Registration MUST record `created_by` as NULL because no admin flow exists yet. The audit columns MUST NOT appear in the user entity `toJSON` or any API response; the existing user response contract MUST stay unchanged.

#### Scenario: Registration records null audit actor

- GIVEN a successful `POST /auth/register`
- WHEN the persisted user row is inspected
- THEN `created_by`, `updated_by`, and `updated_at` are all NULL

#### Scenario: Response hides audit columns

- GIVEN any persisted user
- WHEN the entity is serialized
- THEN `toJSON` contains no `created_by`, `updated_by`, or `updated_at` keys

### Requirement: Account Email Optional in Profile Flows

Accounts created by the student- and teacher-registration flows (alta en uno) MAY have `email` NULL; the mandatory-email rule applies to `POST /auth/register` only. When the payload provides an email, it MUST be syntactically valid (malformed MUST respond 400 and persist nothing) and, if it already belongs to an existing user, that account SHALL be linked per the create-or-link rules instead of rejected as a duplicate.

#### Scenario: Email-less student account

- GIVEN a `POST /students` payload without `email`
- WHEN the alta en uno flow runs
- THEN the created user has `email` NULL

#### Scenario: Malformed email rejected

- GIVEN a `POST /teachers` payload with email `not-an-email`
- WHEN the alta en uno flow runs
- THEN the response is 400
- AND no user or teacher is persisted