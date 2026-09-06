# Delta for Patient Registration

## ADDED Requirements

### Requirement: PAT-007: Update Audit Columns (Internal)

The `patients` table MUST gain nullable `updated_by` and `updated_at` columns while keeping `created_by` and `created_at`. Creation MUST leave `updated_by` and `updated_at` NULL (no update flow exists in this change). These columns MUST NOT appear in the patient `toJSON` or any API response.

#### Scenario: Creation leaves update audit null

- GIVEN a successful `POST /patients`
- WHEN the persisted row is inspected
- THEN `updated_by` and `updated_at` are NULL

#### Scenario: Update audit never serialized

- GIVEN a persisted patient
- WHEN the response body is inspected
- THEN it contains exactly the 11 PAT-006 keys
- AND no `updated_by` or `updated_at` key is present

## MODIFIED Requirements

### Requirement: PAT-004: created_by Actor Seam

The create flow MUST record the acting user in `created_by`. The route factory SHALL accept an optional `getActor(req)` hook; the default hook MUST resolve the actor from the verified token subject exposed on `req.auth` (`sub`/`userId`) — the PAT-004 fix — and MUST fall back to `null` when no verified subject exists. `created_by` MUST equal the actor's id, or NULL when anonymous. Future guards MUST reuse this hook unchanged.
(Previously: the default hook always yielded null because `authenticate` discarded the token `sub`.)

#### Scenario: Anonymous request

- GIVEN a request without an Authorization header
- WHEN `POST /patients` is called
- THEN the patient has `created_by` NULL

#### Scenario: Verified token

- GIVEN a valid token with `sub` `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`
- WHEN `POST /patients` is called through the real `authenticate` middleware with no injected `getActor`
- THEN the patient has `created_by` set to that id

#### Scenario: Invalid token (open route)

- GIVEN a malformed or expired Bearer token
- WHEN `POST /patients` is called
- THEN the create still succeeds (route open)
- AND `created_by` is NULL