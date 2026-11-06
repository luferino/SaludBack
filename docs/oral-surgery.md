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

## Clinical drafts

Each draft is one clinical encounter. Every deliberate `POST` creates a new encounter; an existing draft is resumed by its ID.

| Operation | Permission | Who |
| --- | --- | --- |
| `POST /oral-surgery-drafts` | `oral-surgery-drafts:write` | Student author (`estudiante` role) |
| `PATCH /oral-surgery-drafts/:id` | `oral-surgery-drafts:write` | The original student author only |
| `GET /oral-surgery-drafts/:id` | `oral-surgery-drafts:read` | Author, origin teacher, administrator |
| `GET /oral-surgery-drafts` | `oral-surgery-drafts:read` | Same visibility, filtered |

Migration 040 creates the draft table; migration 041 grants read to students, teachers and administrators and write to students only. Administrators consult globally but never edit clinical content.

### Create

```http
POST /oral-surgery-drafts
Content-Type: application/json
Authorization: Bearer <student-token>

{
  "patient_id": "…",
  "subject_id": "…",
  "academic_group_id": "…",
  "content": { "medical_history": { "hospitalized": false, "taking_medication": null } }
}
```

- `content` is optional; an empty draft is valid.
- The student needs an active habilitation in that subject and group, the subject must be enabled for Oral Surgery I, and the patient must have an active assignment to that habilitation. Otherwise the request returns 403 `an active enabled student context is required` or 404 `patient was not found`.
- The server records the author, the habilitation period, the subject and the group. Clients cannot set them, and they never change afterwards (a database trigger rejects changes).
- The draft is attached to the patient's shared clinical record, which is created on first use.
- Returns 201 with `id`, `clinical_record_id`, `patient_id`, `author_id`, `origin_student_habilitation_id`, `origin_subject_id`, `origin_group_id`, `content`, `status` (`draft`), `version`, `created_at` and `updated_at`.

### Edit

```http
PATCH /oral-surgery-drafts/1
Content-Type: application/json

{ "expected_version": "1", "content": { "treatment_plan": { "procedure": "…" } } }
```

- `content` is required and replaces the whole stored content. Send every answer you want to keep.
- `expected_version` is required. When another save happened first, the response is 409 `draft version changed; reload before saving` and nothing is stored.
- Only the original author can edit, and only while they again hold an active habilitation in the original subject and group plus an active assignment to the patient. The habilitation can be a newer period than the original one. When that access is missing, the response is the same 404 as for an unknown draft.
- Teachers and administrators receive 403 on `POST` and `PATCH`: without the write permission, `Permission 'oral-surgery-drafts:write' required`; with it, `student author role required`.

### Read and list

- Unknown drafts and drafts the caller cannot see both return 404 `oral surgery draft was not found`.
- Requests without a valid token return 401. Draft IDs and versions are positive integers sent as strings; malformed IDs, UUIDs, pagination values or unexpected fields return 400.
- Teachers see drafts from subject/group contexts where they have an active habilitation.
- Students see their own drafts while their access is active, as described for editing.
- `GET /oral-surgery-drafts` accepts optional `patient_id`, `subject_id`, `academic_group_id`, `limit` (1–100, default 50) and `offset` (default 0). It returns `{"items":[...]}`, newest first.

### Content

Every section and field is optional, so incomplete drafts can be saved. Unknown sections or fields return 400.

- Yes/No questions accept `true`, `false` or `null`. An omitted or `null` answer means *not answered*; `false` means *No*. Readback returns exactly what was stored.
- Text fields accept a string of at most 4000 Unicode characters, or `null`. The NUL character (`\u0000`) is rejected because PostgreSQL cannot store it in JSON text.
- `admission_date` accepts `YYYY-MM-DD` or `null`.

| Section | Yes/No fields | Text fields |
| --- | --- | --- |
| `medical_history` | `hospitalized`, `taking_medication`, `has_disease`, `cardiopathy`, `myocardial_infarction`, `angina`, `pacemaker`, `hypertension`, `asthma`, `sinusitis`, `dialysis`, `medication_allergy`, `anesthetic_allergy`, `food_allergy`, `previous_dental_anesthesia`, `anemia`, `hemorrhage`, `hematomas`, `epilepsy`, `convulsions`, `nervous_disease`, `tuberculosis`, `syphilis`, `hepatitis`, `pregnant`, `prenatal_care` | `consultation_reason`, `hospitalization_reason`, `medication`, `medication_duration`, `disease_description`, `other_anesthesia_procedures`, `nervous_disease_type`, `other_infectious_diseases`, `pregnancy_duration`, `other_diseases` |
| `complementary_tests` | `laboratory`, `periapical_radiographs`, `panoramic_radiographs`, `tomography` | `blood_group` |
| `extraoral_exam` | `facial_symmetry` | `skin`, `nose`, `eyes`, `ears`, `salivary_glands`, `lymph_nodes`, `maxillary_sinus` |
| `intraoral_exam` | — | `lips`, `periodontium`, `tongue`, `oral_mucosa`, `mouth_opening`, `prosthesis`, `other` |
| `preoperative` | `vital` | `tooth`, `cc_rr`, `multiple_teeth`, `crown_condition`, `root_condition`, `gingival_mucosa`, `tooth_diagnosis`, `systolic_pressure`, `diastolic_pressure`, `pulse_per_minute`, `temperature` |
| `treatment_plan` | — | `procedure`, `anomalies_or_pathology` |

`cc_rr` stores the form's CC/RR mark as written; the API does not interpret it.

## Scope

This delivery is limited to medical evaluation, clinical examination and treatment-plan drafts. Consent, instructor surgical authorization, operative reports, grading and shared critical-antecedent aggregation are not included.

## Verification

Use database-free tests directly, never `pnpm test` (its pretest runs configured-database migrations):

```sh
node --import tsx --test --test-concurrency=1 tests/unit/oral-surgery-subjects.test.js tests/unit/oral-surgery-drafts.test.js tests/unit/app-composition.test.js
pnpm exec tsc --noEmit
```

`tests/integration/oral-surgery-drafts.test.js` exercises the public API against PostgreSQL, including concurrent edits and access restoration. It runs only through the disposable-database runner (`node tests/helpers/run-isolated-integration.mjs --disposable` with `DISPOSABLE_INTEGRATION_TARGET=true`) and is skipped otherwise.

Synthetic SQL and migration-structure checks are not proof of live PostgreSQL constraints or concurrency. Real database verification requires a separately authorized disposable target.
