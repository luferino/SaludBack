# Patient Registration Specification

## Purpose

Staff-originated entry of patients' personal data (`alta de datos personales`) via `POST /patients`. The route is open today, but MUST expose guard and actor seams so a `pacientes:write` guard and token attribution attach later without rework.

## Requirements

### Requirement: PAT-001: Create Patient Record

The system MUST accept `POST /patients` with `documento`, `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo`, `direccion` and persist a patient. Success MUST respond 201 Created.

#### Scenario: Successful alta

- GIVEN a valid payload and an unused `documento`
- WHEN `POST /patients` is called
- THEN the response is 201
- AND the row is persisted

### Requirement: PAT-002: Documento Uniqueness

`documento` SHALL be unique; a create with an existing one MUST respond 409 and MUST NOT persist or modify any row.

#### Scenario: Duplicate documento

- GIVEN an existing patient with `documento` `35123456`
- WHEN `POST /patients` is called with the same `documento`
- THEN the response is 409 Conflict
- AND no row is created

### Requirement: PAT-003: Input Validation

All eight fields are required; missing, null, or blank MUST respond 400 and persist nothing. `documento` MUST be 4-8 digits (after trim). `sexo` MUST be `M` or `F`. `fecha_nacimiento` MUST be a valid `YYYY-MM-DD` date, not future. `email` MUST match `local@domain`.

#### Scenario: Missing required field

- GIVEN a payload without `apellidos`
- WHEN `POST /patients` is called
- THEN the response is 400
- AND no row is created

#### Scenario: Invalid sexo

- GIVEN a payload with `sexo` `m`
- WHEN `POST /patients` is called
- THEN the response is 400

#### Scenario: Invalid documento

- GIVEN a payload with `documento` `12A4`
- WHEN `POST /patients` is called
- THEN the response is 400

#### Scenario: Documento over 8 digits

- GIVEN a payload with `documento` `123456789`
- WHEN `POST /patients` is called
- THEN the response is 400

#### Scenario: Invalid birth date

- GIVEN a payload with `fecha_nacimiento` `2026-02-31`
- WHEN `POST /patients` is called
- THEN the response is 400

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

### Requirement: PAT-005: Open Guard Seam

`POST /patients` MUST expose a single policy boundary in front of the use case. With no permission guard, the seam MUST allow all requests (default open). With a guard attached, the system SHALL enforce it before the use case.

#### Scenario: Default open

- GIVEN no guard policy attached
- WHEN an unauthenticated client calls `POST /patients`
- THEN the use case runs

#### Scenario: Rejects when guarded

- GIVEN a `pacientes:write` guard and a client without it
- WHEN the client calls `POST /patients`
- THEN the response is 401 or 403
- AND the use case is skipped

### Requirement: PAT-006: Response Contract

The response MUST contain exactly `id`, `documento`, `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo`, `direccion`, `created_by`, `created_at`, no other field. `created_by` SHALL be `null` without an actor.

#### Scenario: Only contract fields

- GIVEN a successful anonymous create
- WHEN the response body is inspected
- THEN the body matches the contract fields
- AND `created_by` is `null`

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

## Non-Goals

- Clinical data, turnos, materias, patient-user linking.
- Permission guard (seam only).
- Document types / per-type validation.
- New env vars or dependencies.
