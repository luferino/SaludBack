# Hygiene and Preventive Dentistry II clinical drafts

Hygiene and Preventive Dentistry II is an Odontology-specific form. Patient identity and the longitudinal clinical record remain shared; its clinical content is independent of the Oral Surgery and Kinesiology APIs.

Delivered: subject configuration and clinical drafts (medical history, FDI odontogram, ceo-d/CPO-D indices and Löe-Silness/O'Leary plaque indices). The procedure log with teacher approval and the paper-consent declarations are delivered too; marital status and medical insurance are later deliveries. Identity (name, C.I., birth date, age, sex and residence) comes from the shared patient record; marital status and medical insurance are not stored in drafts.

## Enable a subject

An authenticated administrator explicitly enables each Odontology subject:

```http
POST /hygiene-preventive-subjects
Content-Type: application/json
Authorization: Bearer <admin-token>

{"subject_id":"10000000-0000-4000-8000-000000000001"}
```

- Returns 201 with `subject_id`, `career_id`, `created_by` and `created_at`.
- `GET /hygiene-preventive-subjects` returns `{"items":[...]}`, ordered by subject ID.
- Both operations require the administrator role and their exact permission: `hygiene-preventive-subjects:write` or `hygiene-preventive-subjects:read`. Oral Surgery subject permissions do not apply.
- A subject's name never enables the form. Multiple subjects can be enabled explicitly, and a subject can be enabled for both Oral Surgery I and this form independently.
- Unknown subjects and non-Odontology subjects return 404 `odontology subject was not found`.
- Duplicate links return 409 `subject is already enabled for hygiene and preventive dentistry`; they do not change the original actor or timestamp.
- POST accepts only a UUID `subject_id`; malformed or extra fields return 400.
- There is no remove, replace or automatic-enable operation.
- Migration 054 adds the association and career constraints; migration 055 seeds admin-only permission grants. No existing subject is enabled automatically.

## Clinical drafts

A draft is one encounter for one patient in one enabled subject and group. Each `POST` creates a new encounter; drafts for the same patient share one `clinical_records` row.

### Endpoints and permissions

| Method and path | Permission | Roles |
| --- | --- | --- |
| `POST /hygiene-preventive-drafts` | `hygiene-preventive-drafts:write` | `estudiante` (author) |
| `GET /hygiene-preventive-drafts` | `hygiene-preventive-drafts:read` | `admin`, `teacher`, `estudiante` |
| `GET /hygiene-preventive-drafts/:id` | `hygiene-preventive-drafts:read` | `admin`, `teacher`, `estudiante` |
| `PATCH /hygiene-preventive-drafts/:id` | `hygiene-preventive-drafts:write` | `estudiante` (author) |
| `GET /hygiene-preventive-subjects/mine` | `hygiene-preventive-drafts:read` | `estudiante`, `teacher` |

- `POST` body: `patient_id`, `subject_id` and `academic_group_id` (canonical UUIDs) and optional `content` (defaults to `{}`). Returns 201 with the draft, `version` `"1"` and `status` `"draft"`.
- `GET` list accepts only `patient_id`, `subject_id`, `academic_group_id` (UUIDs), `limit` (1–100, default 50) and `offset` (0 or more). Items are ordered by ID, newest first.
- `PATCH` body: `expected_version` (mandatory positive BIGINT decimal string) and `content` (full replacement, not a merge). A stale version returns 409 `CONFLICT` with `draft version changed; reload before saving`.
- Reads return `content` with server-computed index totals and plaque results (see below). Provenance fields (`author_id`, `origin_student_habilitation_id`, `origin_subject_id`, `origin_group_id`, `clinical_record_id`, `created_at`) cannot be sent; they are fixed at creation.
- Unknown IDs and drafts the caller cannot see or edit return the same 404 `hygiene preventive draft was not found`.

### Visibility and access

- The author edits only while their student habilitation for the origin subject and group is active (`revoked_at IS NULL`) and they hold an active assignment (`ended_at IS NULL`) for the same patient. A new valid habilitation period and assignment restores access; the origin of an existing draft does not change.
- A teacher reads drafts whose origin subject and group match an active teacher habilitation. Teachers never write.
- An admin reads every draft and never writes.
- Access uses the selected role only, so a secondary profile cannot broaden it.
- Writes lock in the order student period, patient, assignment, draft, matching the Oral Surgery drafts and assignment revocation.
- Migration 056 makes the origin columns immutable with a trigger (`hygiene preventive draft origin is immutable`).

### Content

All content is optional and incomplete saves are allowed. Top-level keys are `medical_history`, `odontogram`, `indices` and `plaque`; any other key returns 400 `unknown content section: <name>`. Omitted, `null` and `false` answers are distinct.

**Medical history** (`medical_history`). Each answer is `true`, `false` or `null` (unanswered); omitting a key means not captured. Each yes/no answer admits an optional `<name>_detail` text:

- Yes/no: `taking_medication`, `allergy_local_anesthetic`, `allergy_penicillin`, `allergy_other_medication`, `dental_treatment_problem`, `cardiovascular_disease`, `diabetes`, `hypertension`, `renal_disease`, `tuberculosis`, `venereal_disease`, `blood_disease`, `other_disease`, `pregnant`.
- Text: each `<name>_detail` above, plus `treating_physician` and `observations`. Text is at most 4000 Unicode code points, contains no NUL character, or is `null`.

**Odontogram** (`odontogram`). An object keyed by FDI tooth code. Valid codes are 11–18, 21–28, 31–38, 41–48, 51–55, 61–65, 71–75 and 81–85; permanent and deciduous teeth may coexist. A tooth that is not a key is unrecorded, never healthy.

- Each recorded tooth requires `state`: `present`, `absent` or `to_extract`. `null` is rejected.
- Optional `surfaces` has keys `occlusal`, `mesial`, `distal`, `vestibular` and `lingual`. Each value is a non-empty array of unique `caries` and/or `filled`; both together mark a secondary caries.
- An `absent` tooth cannot have any marked surface. An `absent` tooth with an empty `surfaces` object is allowed.

**Indices** (`indices`). Each index is an object or `null` (not loaded); an omitted index is not loaded.

| Index | Components | Limit on total |
| --- | --- | --- |
| `ceo_d` | `c`, `e`, `o` | 20 |
| `cpo_d` | `c`, `p`, `o` | 32 |
| `cpo_first_molars` | `c`, `p`, `o` | 4 |

- A loaded index sends all three components as non-negative safe integers. Zero is valid.
- The server computes `total` and returns it for each loaded index. Clients must not send `total`; a PATCH built from a read draft must remove it.
- The server validates ranges and totals only. Clinical counting rules are not applied.

**Plaque indices** (`plaque`). Keys `loe_silness` and `oleary`; each is an object with `teeth`, or `null` (not loaded); an omitted section is not loaded. Only `teeth` is sent and stored. The server computes the results on every read; clients must not send them, so a PATCH built from a read draft must remove them.

Löe-Silness (`plaque.loe_silness.teeth`):

- Teeth 16, 21, 24, 36, 41 and 44 only. Sites `distal`, `vestibular`, `mesial` and `lingual` (palatal/lingual), each an integer grade 0–3.
- An omitted tooth or site is not present and is excluded. An empty tooth object is allowed.
- `average` = sum of grades / recorded sites, rounded to 2 decimals; `null` with no recorded sites.
- `category` from the rounded average: `low` (POCA, ≤ 0.5), `moderate` (MODERADA, ≤ 1.5), `abundant` (ABUNDANTE, > 1.5); `null` without an average. The form's printed ABUNDANTE range «1,3–3» overlaps MODERADA and is applied as 1.6–3.

O'Leary (`plaque.oleary.teeth`):

- Any FDI code valid in the odontogram (permanent and deciduous). A recorded tooth is present and must send all four surfaces `mesial`, `distal`, `vestibular`, `lingual` as booleans (`true` = stained). An omitted tooth is absent or not evaluated.
- `stained_surfaces`, `present_surfaces` (4 × recorded teeth) and `percentage` = stained × 100 / present, rounded to 1 decimal; `percentage` is `null` with no recorded teeth.
- `category` from the rounded percentage: `good` (BUENO, ≤ 30), `fair` (REGULAR, ≤ 60), `poor` (MALO, > 60); `null` without a percentage.

Example read:

```json
"plaque": {
  "loe_silness": { "teeth": { "16": { "distal": 2, "vestibular": 2, "mesial": 2, "lingual": 1 } }, "average": 1.75, "category": "abundant" },
  "oleary": { "teeth": { "11": { "mesial": true, "distal": false, "vestibular": false, "lingual": false } },
    "stained_surfaces": 1, "present_surfaces": 4, "percentage": 25, "category": "good" }
}
```

### Exact validation messages

All 400 responses use `BAD_REQUEST`. `<field>` names the offending key.

| Condition | Message |
| --- | --- |
| Body or content is not an object | `<field> must be an object` |
| Unknown body field | `allowed fields: <list>` |
| Unknown content section | `unknown content section: <name>` |
| Unknown medical-history or nested field | `unknown content field: <path>` |
| Non-boolean yes/no answer | `medical_history.<name> must be boolean or null` |
| Invalid medical-history text (not a string, over 4000 characters, NUL or a lone UTF-16 surrogate) | `medical_history.<name> must be text of at most 4000 characters without NUL, or null` |
| Invalid FDI code | `odontogram.<code> is not a valid FDI tooth code` |
| Invalid or missing tooth state | `odontogram.<code>.state must be present, absent or to_extract` |
| Surfaces not an object | `odontogram.<code>.surfaces must be an object` |
| Invalid surface value | `odontogram.<code>.surfaces.<face> must be a non-empty array of unique caries or filled values` |
| Absent tooth with marked surface | `odontogram.<code> is absent and cannot have marked surfaces` |
| Index not an object or null | `indices.<index> must be an object or null` |
| Unknown index | `unknown content field: indices.<index>` |
| Client-sent total | `indices.<index>.total is computed by the server and must not be sent` |
| Invalid component | `indices.<index>.<component> must be a non-negative safe integer` |
| Total above limit | `indices.<index> total must be at most <limit>` |
| Plaque section not an object or null | `plaque.<section> must be an object or null` |
| Unknown plaque section, field, site or surface | `unknown content field: <path>` |
| Client-sent plaque result | `plaque.<section>.<field> is computed by the server and must not be sent` |
| Missing or non-object teeth / tooth | `plaque.<section>.teeth must be an object` / `plaque.<section>.teeth.<code> must be an object` |
| Löe-Silness tooth outside the six index teeth | `plaque.loe_silness.teeth.<code> must be one of 16, 21, 24, 36, 41, 44` |
| Invalid Löe-Silness grade | `plaque.loe_silness.teeth.<code>.<site> must be an integer grade from 0 to 3` |
| Invalid O'Leary FDI code | `plaque.oleary.teeth.<code> is not a valid FDI tooth code` |
| Missing or non-boolean O'Leary surface | `plaque.oleary.teeth.<code>.<surface> must be boolean` |
| Invalid `expected_version` | `expected_version must be a positive BIGINT decimal string` |
| Invalid draft ID in the path | `draft id must be a positive BIGINT decimal string` |
| Invalid `patient_id`, `subject_id` or `academic_group_id` | `<field> must be a UUID` |
| `limit` (1–100) or `offset` out of range | `limit is out of range` / `offset is out of range` |
| Query parameters on `/hygiene-preventive-subjects/mine` | `query parameters are not supported` |

Other draft and own-context errors:

| Status | Condition | Message |
| --- | --- | --- |
| 401 | Token subject is not a UUID | `A verified UUID actor is required` |
| 403 | Write with a role other than `estudiante` | `student author role required` |
| 403 | Read with a role other than `admin`, `teacher` or `estudiante` | `clinical role required` |
| 403 | `/mine` with a role other than `estudiante` or `teacher` | `estudiante or teacher role required` |
| 403 | Create without an active habilitation in an enabled subject and group | `an active enabled student context is required` |
| 404 | Create for an unknown patient or one without an active assignment in that subject | `patient was not found` |
| 404 | Unknown draft or a draft outside the caller's access | `hygiene preventive draft was not found` |
| 409 | Stale `expected_version` | `draft version changed; reload before saving` |

`GET /hygiene-preventive-subjects/mine` responds with `Cache-Control: no-store`.

### Procedure log

Each draft has its own procedure log, mirroring the paper sheet: free-text entries that the draft's student author records. An entry stays editable and deletable by its author until a teacher approves it; after approval it is final (see Teacher approval below).

#### Endpoints and permissions

| Method and path | Permission | Roles |
| --- | --- | --- |
| `GET /hygiene-preventive-drafts/:id/procedures` | `hygiene-preventive-drafts:read` | `admin`, `teacher`, `estudiante` (same access as the draft) |
| `POST /hygiene-preventive-drafts/:id/procedures` | `hygiene-preventive-drafts:write` | `estudiante` (author) |
| `PATCH /hygiene-preventive-drafts/:id/procedures/:procedureId` | `hygiene-preventive-drafts:write` | `estudiante` (author) |
| `DELETE /hygiene-preventive-drafts/:id/procedures/:procedureId` | `hygiene-preventive-drafts:write` | `estudiante` (author) |
| `POST /hygiene-preventive-drafts/:id/procedures/:procedureId/approval` | `hygiene-preventive-drafts:approve` | `teacher` (active habilitation in the draft's subject and group) |

- `POST` body: `procedure_date` (`YYYY-MM-DD`) and `description`. Returns 201 with the entry.
- `PATCH` body: `expected_version` (mandatory positive BIGINT decimal string), `procedure_date` and `description`. Both date and text are replaced in full. Returns 200 with the entry and an incremented `version`.
- `DELETE` takes `expected_version` in the query string (`?expected_version=<n>`) and returns 204 with no body.
- `GET` list returns `{ items }` in creation order. It accepts no query parameters.
- Adding, editing and deleting entries does not change the draft `version`.
- Each entry carries `version` (string), `status` (`pending` while `approved_at` is null, otherwise `approved`), `student_name` (the author's `nombres apellidos`), and the approval fields `approved_by`, `teacher_name` and `approved_at`. Approval fields stay null until a teacher approves the entry.
- Writes lock in the order student period, patient, assignment, draft, entry, matching draft edits.

#### Exact messages

| Status | When | Message |
| --- | --- | --- |
| 400 | `procedure_date` is not a real `YYYY-MM-DD` date | `procedure_date must be a valid YYYY-MM-DD date` |
| 400 | `procedure_date` is after today (UTC) | `procedure_date cannot be in the future` |
| 400 | `description` is not a string, is blank, exceeds 1000 code points, contains NUL or a lone surrogate | `description must be non-empty text of at most 1000 characters without NUL` |
| 400 | `expected_version`, draft or procedure ID is malformed | `expected_version must be a positive BIGINT decimal string`, `draft id must be a positive BIGINT decimal string`, `procedure id must be a positive BIGINT decimal string` |
| 400 | Unknown field | `allowed fields: procedure_date, description` (POST); `allowed fields: expected_version, procedure_date, description` (PATCH); `allowed fields: expected_version` (DELETE) |
| 400 | Any query on the list | `query parameters are not supported` |
| 403 | Missing write permission, or a non-student caller | `Permission 'hygiene-preventive-drafts:write' required`, `student author role required` |
| 404 | Draft unknown, not visible, or not editable by the caller; for approval, also no active teacher habilitation in the draft's subject and group | `hygiene preventive draft was not found` |
| 404 | Entry unknown or belonging to another draft | `procedure entry was not found` |
| 409 | Stale `expected_version` | `procedure entry version changed; reload before saving` |
| 409 | Edit or delete of an approved entry | `approved procedure entries cannot be changed` |
| 400 | Approval body has any field other than `expected_version` | `allowed fields: expected_version` |
| 403 | Approval without the approve permission | `Permission 'hygiene-preventive-drafts:approve' required` |
| 403 | Approval by a caller that holds the permission but is not a teacher | `teacher instructor role required` |
| 409 | Second approval of an entry | `procedure entry is already approved` |

`description` is stored exactly as sent: surrounding whitespace is kept, and whitespace-only text is rejected. `procedure_date` uses the UTC convention of patient creation.

#### Teacher approval

`POST /hygiene-preventive-drafts/:id/procedures/:procedureId/approval` approves a pending entry. It needs `hygiene-preventive-drafts:approve`, which migration 059 grants to `teacher` only: admins and students never approve, even if the permission appears in their token. The teacher needs an active (not revoked) habilitation in the draft's origin subject and group; otherwise the draft is answered as not found.

- Body: exactly `{"expected_version":"<n>"}`. Any other field is rejected.
- Returns 200 with the entry: `status` is `approved`, `approved_by` is the teacher's user id, `teacher_name` is the teacher's `nombres apellidos`, `approved_at` is the server time, and `version` is incremented.
- Approval is final. A second approval, and any student edit or delete of the entry, answers 409 and changes nothing.
- Approval does not change the draft `version`.
- Locks, in order: the teacher habilitation (`FOR UPDATE`, as in oral surgery authorization), the draft, then the entry.

### Paper consent

Informed consent is recorded as a declaration that a signed paper exists. It is not an electronic signature and no document is uploaded. Only the draft's student author declares it, with the same context check as editing the draft. Admins and teachers can read the declarations.

#### Endpoints and permissions

| Endpoint | Permission | Role |
|---|---|---|
| `POST /hygiene-preventive-drafts/:id/consent` | `hygiene-preventive-drafts:write` | `estudiante` (author) |
| `GET /hygiene-preventive-drafts/:id/consent` | `hygiene-preventive-drafts:read` | `admin`, `teacher`, `estudiante` (same access as the draft) |

- `POST` body: `paper_signed` (must be `true`), `signer` (`patient` or `parent`), and for a parent only `signer_name` and `signer_document`. Returns 201 with `id`, `draft_id`, `signer`, `signer_name`, `signer_document`, `declared_by` and `declared_at`.
- Patient signer: the server copies the patient's `nombres apellidos` and `documento` at declaration time. The request must not send `signer_name` or `signer_document`, even as null.
- Parent signer: `signer_name` is stored exactly as sent. `signer_document` is 4–8 ASCII digits, the same format as the patient documento.
- A patient under 18 on the UTC declaration date (a birthday counts as 18) can only be declared with `parent`.
- `GET` returns 200 with `current_declaration_id` (the latest declaration, or `null`) and `declarations`, oldest first. Declarations are never edited or deleted; to correct a mistake, declare again.
- Declaring does not change the draft `version`.

#### Procedure gate

Adding a procedure entry requires at least one declaration on the draft; without one, `POST .../procedures` answers 409. Editing, deleting and approving existing entries is not affected.

#### Exact messages

| Status | Condition | Message |
|---|---|---|
| 400 | `paper_signed` is not `true` | `paper_signed must be true` |
| 400 | `signer` is not `patient` or `parent` | `signer must be patient or parent` |
| 400 | Parent `signer_name` is blank, longer than 200 characters, or contains NUL or a lone surrogate | `signer_name must be non-empty text of at most 200 characters without NUL` |
| 400 | Parent `signer_document` is not 4–8 digits | `signer_document must be 4-8 digits` |
| 400 | Patient signer sends `signer_name` or `signer_document` | `signer_name and signer_document are only accepted for a parent signer` |
| 400 | Patient under 18 with `signer: patient` | `a parent must sign for a patient under 18` |
| 400 | Unknown field | `allowed fields: paper_signed, signer, signer_name, signer_document` |
| 400 | Malformed draft ID, or any query string on `GET` | `draft id must be a positive BIGINT decimal string`; `query parameters are not supported` |
| 403 | `POST` without write permission, or by a non-student role | `Permission 'hygiene-preventive-drafts:write' required`; `student author role required` |
| 404 | Draft unknown, not visible, or not authored by the caller | `hygiene preventive draft was not found` |
| 409 | Adding a procedure entry with no declaration | `signed paper consent is required before logging procedures` |

### Migrations

- `056_create_hygiene_preventive_drafts.sql` creates `hygiene_preventive_drafts`. Its origin subject references `hygiene_preventive_subjects`. It reuses `clinical_records_id_patient_unique` (031) and `student_habilitations_id_context_unique` (040) and does not re-create them. The origin is immutable.
- `057_seed_hygiene_preventive_draft_permissions.sql` seeds `hygiene-preventive-drafts:read` and `hygiene-preventive-drafts:write`. Students get read and write; teachers and admins get read only.
- `058_create_hygiene_preventive_procedures.sql` creates `hygiene_preventive_procedures` for the procedure log. It references the draft and the users. Its checks enforce a 1–1000 character description and approval columns that are all null (pending) or all set (approved). The origin columns (`id`, `draft_id`, `author_id`, `created_at`) are immutable; a row trigger rejects UPDATE and DELETE of an approved row. TRUNCATE is not a row event, so integration cleanup can still clear approved rows. The date-not-in-the-future and blank-text rules are application checks. No permission is added by this migration.
- `059_seed_hygiene_preventive_procedure_approval_permission.sql` seeds `hygiene-preventive-drafts:approve` and grants it to `teacher` only. Admins and students do not receive it. Approval uses the approval columns that migration 058 already created; no table or column is added.
- `060_create_hygiene_preventive_consent_declarations.sql` creates `hygiene_preventive_consent_declarations` for the paper-consent declarations. It references the draft and the users. Rows are append-only: a row trigger rejects UPDATE and DELETE, and a statement trigger rejects DELETE as migration 053 does for the clinical history tables. Its checks cover the parent format rules (a non-empty name of at most 200 characters, a 4–8 digit documento) and the signer values. The patient snapshot is copied from the patient record, so only the non-empty and signer checks apply to it. The under-18 rule is an application check because it depends on the declaration date. No permission is added.

Plaque indices live in the existing `content` JSONB column and need no migration.

Not yet delivered: marital status and medical insurance.
