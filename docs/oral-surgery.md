# Oral Surgery I clinical drafts

Oral Surgery I is an Odontology-specific form. Patient identity and the longitudinal clinical record remain shared; clinical content does not use the Kinesiology API.

## Enable a subject

An authenticated administrator explicitly enables each Odontology subject:

```http
POST /oral-surgery-subjects
Content-Type: application/json
Authorization: Bearer <admin-token>

{"subject_id":"10000000-0000-4000-8000-000000000001"}
```

- Returns 201 with `subject_id`, `career_id`, `created_by` and `created_at`.
- `GET /oral-surgery-subjects` returns `{"items":[...]}`, ordered by subject ID.
- Both operations require the administrator role and their exact respective permissions: `oral-surgery-subjects:write` or `oral-surgery-subjects:read`.
- A subject's name never enables the form. Multiple subjects can be enabled explicitly.
- Unknown subjects and non-Odontology subjects return 404 `odontology subject was not found`.
- Duplicate links return 409 `subject is already enabled for oral surgery`; they do not change the original actor/timestamp.
- POST accepts only a UUID `subject_id`; malformed/extra fields return 400.
- There is no remove, replace or automatic-enable operation in this delivery.
- Migration 038 adds the association and career constraints; migration 039 seeds admin-only permission grants. No existing subject is enabled automatically.

## Scope

This delivery is limited to medical evaluation, clinical examination and treatment-plan drafts. Consent, instructor surgical authorization, operative reports, grading and shared critical-antecedent aggregation are not included.

## Verification

Use database-free tests directly, never `pnpm test` (its pretest runs configured-database migrations):

```sh
node --import tsx --test --test-concurrency=1 tests/unit/oral-surgery-subjects.test.js tests/unit/app-composition.test.js
pnpm exec tsc --noEmit
```

Synthetic SQL and migration-structure checks are not proof of live PostgreSQL constraints or concurrency. Real database verification requires a separately authorized disposable target.
