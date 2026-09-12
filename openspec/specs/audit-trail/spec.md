# Audit Trail Specification

## Purpose

Uniform internal audit convention across business tables: `created_by`/`created_at`/`updated_by`/`updated_at`. These columns are bookkeeping, not API surface; only contracts that explicitly list them (PAT-006, STU-004, TEA-003) expose `created_*`. `password_reset_tokens` is exempt.

## Requirements

### Requirement: AUD-001: Uniform Audit Columns

Every business table (`users`, `patients`, `students`, `teachers`) MUST carry `created_by` (nullable FK to `users.id`), `created_at` (NOT NULL, default now()), `updated_by` (nullable FK to `users.id`), and `updated_at` (nullable, no default). Creation MUST set both `updated_*` columns to NULL. `password_reset_tokens` MUST NOT gain audit columns; its atomic create flow stays untouched. All tables MUST keep UUID primary keys (no bigserial), and `patients` MUST NOT be renamed.

#### Scenario: New tables carry the convention

- GIVEN migration `004` applied
- WHEN the schema is inspected
- THEN `students` and `teachers` have all four audit columns
- AND `users`/`patients` have their new nullable audit columns

#### Scenario: Exempt table untouched

- GIVEN `password_reset_tokens`
- WHEN the schema is inspected
- THEN it has only `created_at` among audit columns
- AND its create flow is unchanged

### Requirement: AUD-002: Audit Fields Are Internal

`updated_by` and `updated_at` MUST NOT appear in any entity `toJSON`, API response, or error payload. `created_by`/`created_at` MAY appear only where an explicit contract lists them. Existing response contracts MUST remain byte-stable.

#### Scenario: Patient contract stable

- GIVEN any patient create response
- WHEN the body is inspected
- THEN it contains exactly the 11 PAT-006 keys
- AND no `updated_by` or `updated_at` key

#### Scenario: New entities hide update audit

- GIVEN any student or teacher response
- WHEN the body is inspected
- THEN no `updated_by` or `updated_at` key is present

### Requirement: AUD-003: Actor Resolution Convention

Profile creates (`patients`, `students`, `teachers`) MUST record `created_by` from the verified admin token subject exposed on `req.auth` (`sub`/`userId`) — those routes are admin-only. `users.created_by` MUST be stamped the same way: the register and alta-en-uno flows record the acting admin in the account row, and NULL only when a flow runs without a verified subject (no such route exists today — every create is admin-gated).
(Previously: `users.created_by` MUST remain NULL because no admin flow existed and registration stayed open.)

#### Scenario: Verified subject attributed

- GIVEN a request with a valid admin token carrying `sub`
- WHEN a create (user or profile) runs
- THEN `created_by` equals the `sub`

#### Scenario: Creation without a verified subject

- GIVEN a create flow that runs without a verified token subject
- WHEN the create runs
- THEN `created_by` is NULL