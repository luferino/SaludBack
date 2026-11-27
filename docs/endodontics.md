# Endodontics drafts

This delivery adds explicit Endodontics subject links, an incomplete student-authored diagnostic draft, and one treatment report per draft that a teacher can close and lock. It does not submit, sign, classify, or execute clinical treatment. Patient identity and demographics are referenced through the existing `patient_id`; they are never copied into draft content.

## Permissions and access

- `endodontics-subjects:read` and `endodontics-subjects:write`: administrator-managed subject links (T1).
- `endodontics-drafts:write`: student creates and replaces their own draft. The repository checks the student's active Endodontics subject/group habilitation and active patient assignment transactionally. A current reactivated habilitation/assignment restores access for the original author.
- `endodontics-drafts:read`: students read their own drafts while active context and assignment remain valid; teachers read drafts only in their active subject/group context; administrators read globally. Teacher and administrator access is read-only.
- `endodontics-treatment-reports:close`: granted to `teacher` only (migration 070). The closing teacher needs an active habilitation in the draft's own subject/group. Students and administrators never hold it.
- Treatment reports have no separate read or write permission: the student author creates and edits with `endodontics-drafts:write`, and anyone who can read the draft reads its report with `endodontics-drafts:read`.

`GET /endodontics-subjects/mine` uses `endodontics-drafts:read`; it is available to students and teachers and returns only `{ subject_id, academic_group_id }` pairs for their active Endodontics contexts. It rejects other roles and query parameters and sends `Cache-Control: no-store`.

## Draft endpoints

All endpoints are authenticated. The server reloads the caller's permissions for the active role.

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/endodontics-drafts` | Create an incomplete draft; requires `endodontics-drafts:write` and student role. |
| `GET` | `/endodontics-drafts` | List drafts visible under the caller's current access; requires `endodontics-drafts:read`. |
| `GET` | `/endodontics-drafts/:id` | Read a visible draft; requires `endodontics-drafts:read`. |
| `PATCH` | `/endodontics-drafts/:id` | Replace the full content of the author's draft if `expected_version` still matches; requires `endodontics-drafts:write` and student role. |
| `POST` | `/endodontics-drafts/:id/treatment-report` | Create the single treatment report for the draft; requires `endodontics-drafts:write` and student author role. A second report returns 409. |
| `GET` | `/endodontics-drafts/:id/treatment-report` | Read the draft's report with the draft read scope; requires `endodontics-drafts:read`. |
| `PATCH` | `/endodontics-drafts/:id/treatment-report` | Replace the report's full content while open if `expected_version` matches; requires `endodontics-drafts:write` and student author role. |
| `POST` | `/endodontics-drafts/:id/treatment-report/close` | Close and lock the report and its draft; requires `endodontics-treatment-reports:close` and the teacher role in the draft's context, `expected_version` and `expected_draft_version`. Either mismatch returns 409 and changes nothing. |

Create body:

```json
{
  "patient_id": "<existing patient UUID>",
  "subject_id": "<linked subject UUID>",
  "academic_group_id": "<academic group UUID>",
  "content": {}
}
```

`content` may be empty or contain any subset of the fields below. It is not required to be clinically complete. The database reuses the shared `clinical_records` row for the referenced patient; draft content does not duplicate patient demographics.

PATCH body is a complete replacement, not a merge:

```json
{
  "expected_version": "1",
  "content": { "pain": { "intensity": 0 } }
}
```

A successful replacement increments `version`. Reload and retry after a version conflict; rejected validation and stale-version requests do not replace stored content.

## Content groups

JSON field names below are the API vocabulary. Omitted fields are not recorded. For yes/no answers, `null` means unanswered, `false` means No, and `true` means Yes. These states are not interchangeable.

- `tooth_or_region`: optional single text value identifying one tooth or region; `null` or omission means not recorded. The server does not parse or decide clinical tooth/region semantics.
- `patient_history`: `responsible_physician`, `physician_phone`, `general_health`, `last_medical_exam`, `blood_pressure`; yes/no/unanswered `current_treatment` with `current_treatment_reason`, `medication` with `medication_name_reason`, `medication_allergy` with `allergy_detail`, `recent_hospitalization` with `hospitalization_reason`, and `previous_operation` with `operation_reason`; habits as recorded text: `smoking_years`, `cigarettes_per_day`, `alcohol_type`, `alcohol_amount_per_day`, `other_habits`, `drugs_type`, `drug_dependency`. Printed yes/no/unanswered groups are `cardiovascular`, `hematologic`, `neurologic`, `respiratory`, `gastrointestinal`, `endocrine`, `urinary`, `musculoskeletal`, `eye_ear_nose_throat`, `social`, and `infectious`; each may have matching `<field>_detail` text (for example `cardiovascular_detail`).
- `complaint`: text `chief_complaint`, `reason_for_treatment`, `pain_location`, `onset`, `provoking_factor`, `relieving_factor`, `frequency`, `time_since_onset`, `expectations`; yes/no/unanswered `prior_anesthesia_reaction`, `treatment_trauma`, `prior_endodontic_treatment`, `dental_trauma`.
- `pain`: text `location`, `onset`, `provoking_factor`, `relieving_factor`, `frequency`, `time_since_onset`; optional integer `intensity` from 0 to 10; printed choices `distribution` (`localized`, `diffuse`), `trigger` (`provoked`, `spontaneous`), `duration` (`short`, `long`), and `pattern` (`intermittent`, `continuous`). Missing intensity is distinct from 0. No severity, band, or category is calculated.
- `examination`: `tooth_structure` (`intact`, `decayed`, `restored`, `fractured`); `color` (`normal`, `modified`); `edema` options (`local`, `diffuse`, `mucosal`, `cutaneous`); `fistula` options (`intraoral`, `extraoral`); `caries_depth` (`shallow`, `medium`, `deep`); yes/no/unanswered `protective_material` with optional text `protective_material_type`, `trauma`, `periodontal_pocket` with optional text `pocket_depth`, coronal/periapical palpation and percussion, vertical/horizontal mobility, ATM pain, mouth-opening pain, and midline deviation. `restorative_material` is `amalgam`, `resin`, or `other`; `wear` options are `erosion`, `abrasion`, `attrition`; `hygiene` is `good`, `regular`, or `poor`; `edema_evolution` is `evolving`, `absent`, or `evolved`; `observations` is text. Where the form's table alignment is unclear, use the yes/no/unanswered or free-text fields instead of implying a clinical mapping.
- `vitality`: `cold`, `heat`, and `electric` accept printed `relief` and/or `stimulus` marks. `cavity_test` and `anesthesia_test` are yes/no/unanswered; `observations` is recorded text only.
- `radiography`: multi-select `chamber`, `canals`, and `periapical` arrays use only printed choices. Chamber: `normal_wide`, `narrow`, `calcified`, `calculus`, `filled`, `decayed`, `absent`, `destroyed`. Canals: `normal_wide`, `narrow`, `internal_resorption`, `external_resorption`, `fully_filled`, `partly_filled`, `incomplete_rhizogenesis`, `osteosclerosis`. Periapical: `normal`, `widened_ligament_space`, `hypercementosis`, `periapical_bone_resorption`, `diffuse_rarefaction`, `circumscribed_rarefaction`, `condensing_osteitis`. `notes` is free text and may mention a canal; there is no separate per-canal record.
- `probable_diagnosis`: multi-select printed options: `normal_pulp_prosthetic_aesthetic`, `reversible_pulpitis_pulpal_wound`, `reversible_pulpitis_inflammatory`, `reversible_pulpitis_incipient`, `irreversible_pulpitis_acute`, `irreversible_pulpitis_acute_abscessed`, `irreversible_pulpitis_chronic_ulcerated`, `irreversible_pulpitis_hyperplastic`, `mortified_pulp_necrosis`, `mortified_pulp_gangrene`, `acute_apical_periodontitis`, `acute_dento_alveolar_abscess_initial`, `acute_dento_alveolar_abscess_evolving`, `acute_dento_alveolar_abscess_evolved`, `chronic_abscess_fistula`, `probable_cyst`, `probable_granuloma`, `chronic_process_exacerbation`, `apical_scar`, `prior_treatment_failure`, `iatrogenesis`, `other`. Optional `diagnosis_other_text` records the student's text for `other`.
- `proposed_plan`: multi-select printed options: `deep_caries_treatment`, `indirect_pulp_protection`, `direct_pulp_protection`, `intentional_extirpation`, `pulpotomy`, `partial_biopulpectomy`, `total_biopulpectomy`, `necropulpectomy`, `apexogenesis`, `apexification`, `retreatment`, `paraendodontic_surgery`, `clinical_control`, `radiographic_control`, `referral`, `other`. Optional `plan_other_text` records the student's text for `other`.
- `teacher_observations`: optional teacher-control observation text.

Multi-selects permit multiple printed selections without clinical exclusivity checks. Text fields are limited to 4,000 Unicode code points and reject NUL and lone UTF-16 surrogates. Unknown top-level or nested keys and non-printed enum values are rejected.

## Treatment report

The report records the treatment page of the paper form for one diagnostic draft. The student author completes it while it is open. A teacher in the draft's subject/group closes it, which locks the report and its draft. Patient identity is referenced through the draft's existing patient. The header (date, patient, professional, two contact pairs) and the footer (signature and date) are not stored.

Create body (`content` may be empty):

```json
{ "content": { "treated_teeth": ["16"], "session_count": 2 } }
```

PATCH is a complete replacement, not a merge: `{ "expected_version": "1", "content": { } }`. Each successful write increments `version`.

Close body: `{ "expected_version": "2", "expected_draft_version": "1" }`. Closing requires `expected_version` and `expected_draft_version`, so a draft edited after the teacher loaded it cannot be closed by a stale view. Closing sets `status` to `closed` and records `closed_by`, `closed_at`, and `teacher_habilitation_id`. Responses include `draft_id`, `content`, `version` (string), `status`, `created_by`, `created_at`, `updated_at`, `closed_by`, `closed_at`, and `teacher_habilitation_id`.

Content fields (API vocabulary; omitted fields are not recorded; no unit validation; no clinical inference):

- `treated_teeth`: array of up to 8 non-empty text entries. The server does not match these to the draft's `tooth_or_region`.
- `diagnosis`, `treatment_plan`, `accidents`, `observations`: text or `null`.
- `session_count`: integer 0 or greater, or `null`. Per-session dates are left to attendance control.
- `access_procedures`: fixed rows `access_cavity_preparation`, `canal_entry_preparation`, `anticurvature_wear`, and `other`. Each row takes text cells `high_speed_bur`, `low_speed_bur`, `rotary_file`, `manual_file`, and `other`.
- `technique_checklists`: printed multi-selects. Each entry is `{ "selected": [...], "other_text": text|null }` with unique printed options:
  - `instrumentation_technique`: `manual`, `rotary`, `oscillatory`, `hybrid`, `ultrasonic`, `laser`.
  - `rotary_system`: `Free Tip`, `Protaper`, `K3`, `RACE`, `Endo IZE`, `Injecta`. The printed spelling is kept because the scan is low resolution; alternatives go in `other_text`.
  - `modality`: `traditional`, `crown_down`, `step_back`, `stepped`, `double_stepped`, `goerig_et_al`.
  - `obturation_technique`: `lateral_condensation`, `vertical_condensation`, `thermomechanical`, `single_cone`, `injectable`, `cement_only`.
  - `irrigants`: `sodium_hypochlorite`, `detergent`, `edta`, `hydrogen_peroxide`, `chlorhexidine`, `lime_water`. Also `percentages` text for `sodium_hypochlorite`, `edta`, and `chlorhexidine`.
  - `intracanal_medication`: `calcium_hydroxide`, `pmcc`, `antibiotic`, `formocresol`, `corticosteroids`, `iodoform`.
  - `sealer`: `oze`, `calcium_hydroxide`, `glass_ionomer`, `resins`, `silicone`, `mta`.
- `canal_measurements`: up to 64 rows. Each row has text cells `tooth`, `canal`, `reference_point`, `real_tooth_length`, `real_working_length`, `apical_patency_instrument`, `initial_instrument`, `memory_instrument`, `final_instrument`, `main_gutta_percha`, and `accessory_gutta_percha`, plus `obturation_cut: { "option": "canal_entry" | "apex_mm" | null, "apex_mm": text|null }`. The 64-row bound is a technical limit, not a clinical rule (8 treated teeth × up to 8 canals each); the printed form does not state a row count.

Text follows the draft rules: at most 4,000 Unicode code points, no NUL, and no lone UTF-16 surrogates. Unknown keys at any level are rejected, which also blocks patient demographics and header fields.

Lock behavior:

- Student writes take locks in this order: the active student period, the patient row, the active assignment, the draft row, then the report row. Closing takes the teacher's active period, then the draft row, then the report row. Draft edits take the draft row lock first, then run a separate closed-state check on the report. A closing transaction holds the same draft lock until it commits, so the check cannot miss a close that committed while the edit was waiting.
- Closing runs in one transaction: `status`, the audit fields, and `version` change together. After the draft row lock, the server compares `expected_draft_version` with the draft version; then it compares `expected_version` with the report version. Either mismatch, or an already closed report, returns 409 and writes nothing.
- A closed report cannot change or be deleted. Its draft cannot change `content` or `version`. The repository returns 409 first, and database triggers reject the same change with SQLSTATE 23514 as a second guard. `draft_id`, `created_by`, and `created_at` never change.

## Errors

Errors use `{ "error": { "code": "...", "message": "..." } }`.

- `400 BAD_REQUEST`: invalid body/UUID/version syntax, unknown fields, invalid types/options, text bounds, or pain outside integer 0–10. Examples include `pain.intensity must be an integer from 0 to 10, or null`, `patient_history.medication must be boolean or null`, and `unknown content section: patient_name`.
- `401 UNAUTHORIZED`: authentication is missing/invalid or a verified UUID actor is unavailable.
- `403 FORBIDDEN`: missing permission (for example `Permission 'endodontics-drafts:read' required`) or a role cannot perform the operation (`student author role required`).
- `404 NOT_FOUND`: draft is missing or outside the reader's live context (`endodontics draft was not found`); an unavailable patient returns `patient was not found`. A visible draft with no report returns `endodontics treatment report was not found`.
- `409 CONFLICT`: stale version (`draft version changed; reload before saving`); a second report for a draft (`treatment report already exists; reload before saving`); a stale or closed report (`treatment report changed or is closed; reload before saving`); or a draft locked by a closed report (`endodontics draft is locked by a closed treatment report`).
- Unexpected failures return a generic `500 INTERNAL_SERVER_ERROR`.

## Deferred / out of scope

No automatic diagnosis, combinations validation, severity/category calculation, copied identity/demographics, demographic edits, or changes to other patient histories. No signed patient authorization or consent, signature capture, per-session dates or attendance control, discharge, return visit, submissions, or clinical-completeness gate. Treatment-report fields are stored as recorded text, with no unit checks, no tooth matching against the diagnostic draft, and no clinical inference. No screen or deployment/publishing work is included.
