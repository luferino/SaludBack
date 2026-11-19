# Patient registry API

The patient registry provides a general administrator listing and a separate career-scoped Reception listing. Patient creation remains governed by its existing write permission; listing access does not grant or change write access.

## Administrator listing

`GET /patients` requires an authenticated user with role `admin` (`AdminGuard`). It is independent of `patients:write`, which continues to guard `POST /patients`; permissions on a token do not let another role access the general registry.

| Query | Behavior |
|---|---|
| `q` | Optional, trimmed, case-insensitive literal substring over document, given names, or surnames. `%`, `_`, and backslash are literal characters. Blank/whitespace-only means no text filter. |
| `limit` | Optional integer, default `50`, range `1–100`. |
| `offset` | Optional integer, default `0`, range `0–10000`. |

Each parameter may appear once. Unknown/repeated parameters, malformed or out-of-range pagination, and `q` longer than 100 characters return `400 BAD_REQUEST`. Results are ordered by surname, given names, then ID. The response is `{ "items": [...], "limit": 50, "offset": 0 }`; each item contains exactly `id`, `documento`, `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo`, `direccion`, `marital_status`, and `medical_insurance`. Audit fields and totals are omitted. Responses use `Cache-Control: no-store`.

## Reception listing

`GET /reception/patients?career=kinesiology` or `?career=odontology` requires the Reception patient-management permission and an active grant for the selected career. The grant is checked live in the scoped operation; only patients enrolled in that career are listed. It accepts the same `q`, `limit`, and `offset` semantics and validation above, except `limit` defaults to `100` to preserve the existing Reception behavior. `career` is required and unique. Results retain surname/given-name/ID order and the same patient projection as the administrator listing (the nine identity/contact fields plus `marital_status` and `medical_insurance`), with additive `limit` and `offset` metadata. An inactive or revoked career grant remains denied; search never broadens career scope.

## Patient creation

`POST /patients` requires the existing `patients:write` permission and returns the creation DTO, including its established creator attribution. The new administrator listing neither bypasses nor alters this guard.

Both personal-data fields are optional on creation. An omitted field is stored as `null` (not recorded). An invalid value returns `400 BAD_REQUEST` before any duplicate-documento lookup:

- `marital_status` must be `single`, `married`, `divorced`, `widowed`, `civil_union`, or `null`. Otherwise: `marital_status must be single, married, divorced, widowed, civil_union or null`.
- `medical_insurance` must be `ips`, `police_health`, `military_health`, `none`, or `null`. Otherwise: `medical_insurance must be ips, police_health, military_health, none or null`.

`none` means declared without insurance; `null` means not recorded.

## Personal data update

`PATCH /patients/:id` changes only `marital_status` and `medical_insurance` on the shared patient record. It requires the `patients:write` permission and the `admin` role (`AdminGuard`). The same token values and messages as creation apply.

- A field that is omitted keeps its stored value; `null` clears it. Every write sets `updated_by` and `updated_at`.
- Any other key returns `400 BAD_REQUEST`: `allowed fields: marital_status, medical_insurance`.
- A non-object body (including an array) returns `400`: `body must be an object`.
- A body with no recognized key returns `400`: `at least one of marital_status or medical_insurance is required`.
- A malformed `:id` returns `400`: `id must be a UUID`.
- An unknown patient returns `404 NOT_FOUND`: `patient was not found`.
- A success returns `200` with the 13-key patient DTO: the 11 creation/listing keys plus `marital_status` and `medical_insurance`. Audit fields are not serialized.

## Student and teacher personal data

`GET /patients/:id/personal-data` and `PATCH /patients/:id/personal-data` serve the clinical form header and the two personal-data fields to students and teachers. Access is decided per patient in SQL, using only the selected role of the token.

| Endpoint | Permission (migration 062) | Selected role | Behavior |
|---|---|---|---|
| `GET /patients/:id/personal-data` | `patient-personal-data:read`, granted to `estudiante` and `teacher` | `estudiante` or `teacher` | Read. Responds with `Cache-Control: no-store`. |
| `PATCH /patients/:id/personal-data` | `patient-personal-data:write`, granted to `estudiante` only | `estudiante` | Writes `marital_status` and/or `medical_insurance`. Responds with `Cache-Control: no-store`. |

Admin and Reception do not receive either permission. They keep their own endpoints (`PATCH /patients/:id` for admin, `PATCH /reception/patients/:id` for Reception).

### Access rules

- `estudiante` (read and write): the actor's student row has an active habilitation (`student_academic_habilitations.revoked_at IS NULL`) with an active assignment to this patient (`patient_assignments.ended_at IS NULL`) on that same habilitation. Any subject and any career qualify.
- `teacher` (read only): the actor's teacher row has an active habilitation (`teacher_academic_habilitations.revoked_at IS NULL`) on the same subject and academic group as the student habilitation behind an active assignment of this patient. That student habilitation must be active too.
- Any other case, including an unknown patient, returns `404 NOT_FOUND` with `patient was not found`, so the existence of a patient is never revealed.

### Checks and messages

Checks run in this order. The first failure answers.

GET:

1. Missing permission: `403` with `Permission 'patient-personal-data:read' required`.
2. Role other than `estudiante` or `teacher`: `403` with `estudiante or teacher role required`.
3. No verified UUID actor: `401` with `A verified UUID actor is required`.
4. `:id` not a UUID: `400` with `id must be a UUID`.
5. Any query string: `400` with `query parameters are not supported`.
6. No access or unknown patient: `404` with `patient was not found`.

PATCH:

1. Missing permission: `403` with `Permission 'patient-personal-data:write' required`.
2. Role other than `estudiante`: `403` with `student role required`.
3. No verified UUID actor: `401` with `A verified UUID actor is required`.
4. `:id` not a UUID: `400` with `id must be a UUID`.
5. Body rules below, then the token rules of the create section (`marital_status must be single, married, divorced, widowed, civil_union or null`, `medical_insurance must be ips, police_health, military_health, none or null`).
6. No access or unknown patient: `404` with `patient was not found`.

Body rules for the PATCH: a non-object body (including an array) returns `400` with `body must be an object`; any key other than `marital_status` or `medical_insurance` returns `400` with `allowed fields: marital_status, medical_insurance`; a body with no recognized key returns `400` with `at least one of marital_status or medical_insurance is required`. An omitted field keeps its stored value, and `null` clears it. Every successful write sets `updated_by` and `updated_at`.

### Response

Both endpoints return `200` with exactly these keys, in this order: `id`, `documento`, `nombres`, `apellidos`, `fecha_nacimiento` (`YYYY-MM-DD`), `sexo`, `direccion`, `marital_status`, `medical_insurance`. Email, celular and audit fields are never included.

### Concurrency

The PATCH runs in one transaction. It locks, in this order, the student's active habilitation, the patient and the matching active assignment (`FOR UPDATE`). This is the order the hygiene draft writes use. A revocation or an assignment end therefore waits for the commit, and the access check holds until the write is committed. The GET is a single statement and takes no lock.

### Migration 062

`062_seed_patient_personal_data_permissions.sql` seeds the two permissions (enforced) and three grants: `estudiante` gets read and write, `teacher` gets read. It adds no table and no column.
