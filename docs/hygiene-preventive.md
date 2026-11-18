# Hygiene and Preventive Dentistry II clinical drafts

Hygiene and Preventive Dentistry II is an Odontology-specific form. Patient identity and the longitudinal clinical record remain shared; its clinical content is independent of the Oral Surgery and Kinesiology APIs.

Delivered: subject configuration and clinical drafts (medical history, FDI odontogram, ceo-d/CPO-D indices and Löe-Silness/O'Leary plaque indices). The procedure log with teacher signature, informed consent, marital status and medical insurance are later deliveries. Identity (name, C.I., birth date, age, sex and residence) comes from the shared patient record; marital status and medical insurance are not stored in drafts.

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

### Migrations

- `056_create_hygiene_preventive_drafts.sql` creates `hygiene_preventive_drafts`. Its origin subject references `hygiene_preventive_subjects`. It reuses `clinical_records_id_patient_unique` (031) and `student_habilitations_id_context_unique` (040) and does not re-create them. The origin is immutable.
- `057_seed_hygiene_preventive_draft_permissions.sql` seeds `hygiene-preventive-drafts:read` and `hygiene-preventive-drafts:write`. Students get read and write; teachers and admins get read only.

Plaque indices live in the existing `content` JSONB column and need no migration.

Not yet delivered: the procedure log with teacher signature, informed consent, marital status and medical insurance.
