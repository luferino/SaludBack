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

## Discover own enabled contexts

Authenticated students and teachers can discover the subject/group pairs currently enabled for Oral Surgery I:

```http
GET /oral-surgery-subjects/mine
Authorization: Bearer <student-or-teacher-token>
```

- Requires `oral-surgery-drafts:read`, a verified UUID actor, and role `estudiante` or `teacher`. Administrators are not allowed, even when they hold the permission.
- Returns exactly `{"items":[{"subject_id":"…","academic_group_id":"…"}]}` with unique pairs ordered by subject and group ID. Only the authenticated role's own non-revoked habilitations intersecting enabled Oral Surgery subjects are returned.
- Query parameters are rejected; this discovery endpoint has no filters or pagination. Successful responses use `Cache-Control: no-store`.
- This enables form-context discovery only. It does not grant visibility to patients or clinical records; draft access rules remain unchanged.

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

## Signed paper consent

The student author attests that signed paper consent exists. This is **not a patient electronic signature** and no document is uploaded.

```http
POST /oral-surgery-drafts/1/consent
Content-Type: application/json

{"expected_version":"1","paper_signed":true}
```

- Requires `oral-surgery-drafts:write`, the original student author, and the same current habilitation/assignment as editing. Teachers and administrators cannot declare for the student.
- Only `expected_version` and `paper_signed` are accepted. The latter must be literal `true`; missing, false or other values return 400. ID/version validation is the same as PATCH.
- Returns 201 with `id`, `draft_id`, `draft_version`, `plan_revision`, `treatment_plan`, `declared_by` and `declared_at`. Actor, timestamp and plan snapshot are server-owned.
- A stale version returns 409 `draft version changed; reload before saving`, with no declaration created. Declaring does not edit the draft or increment its version.
- `GET /oral-surgery-drafts/:id/consent` requires draft read permission and the same visibility as the draft. It returns `draft_version`, `plan_revision`, `current_declaration_id` (or null), and `declarations` ordered oldest first.
- Unrelated clinical edits preserve the declaration's applicability. Any change to the stored `treatment_plan` section (including clearing it) requires a new declaration. Changing back to the previous plan does not reactivate old consent.
- Previous declarations remain in history. There is no update/delete route. Unknown or inaccessible drafts return the same 404 as draft reads.
- Migration 042 adds the declaration history and monotonic plan revision. Existing draft responses and PATCH behavior are unchanged.

## Instructor authorization

An active teacher in the draft's original subject/group verifies the signed paper and authorizes the exact clinical version reviewed.

```http
POST /oral-surgery-drafts/1/authorizations
Content-Type: application/json

{"expected_version":"1","consent_declaration_id":"1","paper_consent_verified":true}
```

- Requires the separate `oral-surgery-drafts:authorize` permission and the `teacher` role. Migration 044 initially grants it only to teachers. Administrators do not authorize on their behalf, even with the permission.
- Only the three shown fields are accepted. IDs/versions must be positive BIGINT decimal strings and `paper_consent_verified` must be literal `true`; malformed/extra fields return 400 before storage.
- The specified consent must belong to this encounter and its current uninterrupted plan revision. Missing, foreign-encounter or obsolete consent returns 409 `current signed paper consent declaration is required`. A prior declaration for the same unchanged plan is still acceptable.
- A stale clinical version returns 409 `draft version changed; reload before saving`. Unknown encounters or missing current origin-context teacher habilitation return 404 `oral surgery draft was not found`.
- Returns 201 with `id`, `draft_id`, `draft_version`, `consent_declaration_id`, `reviewed_content`, `authorized_by`, `teacher_habilitation_id` and `authorized_at`. This immutable snapshot and its server-owned attribution preserve exactly what was authorized.
- This action also records that the instructor verified the paper consent. It does not edit the clinical content, advance the draft version, or act as the patient's signature.
- `GET /oral-surgery-drafts/:id/authorizations` uses the existing draft read permission/visibility. Returns `draft_version`, `current_authorization_id` (or null), and `authorizations` oldest first.
- Every successful PATCH, even saving identical content, advances the draft version and requires a new authorization. Old authorizations and their reviewed snapshots remain in history; there is no update/delete route.
- A changed treatment plan additionally requires a fresh student declaration. Unrelated edits need only renewed instructor authorization.
- Reads require current access, but later habilitation revocation does not erase historical authorizations or retroactively change the recorded clinical version. The current ID means version applicability, not a guarantee of clinical completeness or consent-law compliance.
- Migration 043 adds authorization history; migration 044 adds its enforced permission. The locks serialize instructor authorization with clinical edits and teacher revocation.

## Scope

Medical evaluation, clinical examination, treatment-plan drafts, signed-paper consent declarations and version-bound instructor authorization are included. Operative reports, grading, attachments, patient electronic signatures and shared critical-antecedent aggregation are not included.

## Verification

Use database-free tests directly, never `pnpm test` (its pretest runs configured-database migrations):

```sh
node --import tsx --test --test-concurrency=1 tests/unit/oral-surgery-subjects.test.js tests/unit/oral-surgery-drafts.test.js tests/unit/app-composition.test.js
pnpm exec tsc --noEmit
```

`tests/integration/oral-surgery-drafts.test.js` exercises the public API against PostgreSQL, including concurrent edits and access restoration. It runs only through the disposable-database runner (`node tests/helpers/run-isolated-integration.mjs --disposable` with `DISPOSABLE_INTEGRATION_TARGET=true`) and is skipped otherwise.

Synthetic SQL and migration-structure checks are not proof of live PostgreSQL constraints or concurrency. Real database verification requires a separately authorized disposable target.
