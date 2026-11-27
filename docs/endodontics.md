# Endodontics drafts

This delivery adds explicit Endodontics subject links and an incomplete, student-authored diagnostic draft. It does not submit, sign, classify, or execute clinical treatment. Patient identity and demographics are referenced through the existing `patient_id`; they are never copied into draft content.

## Permissions and access

- `endodontics-subjects:read` and `endodontics-subjects:write`: administrator-managed subject links (T1).
- `endodontics-drafts:write`: student creates and replaces their own draft. The repository checks the student's active Endodontics subject/group habilitation and active patient assignment transactionally. A current reactivated habilitation/assignment restores access for the original author.
- `endodontics-drafts:read`: students read their own drafts while active context and assignment remain valid; teachers read drafts only in their active subject/group context; administrators read globally. Teacher and administrator access is read-only.

`GET /endodontics-subjects/mine` uses `endodontics-drafts:read`; it is available to students and teachers and returns only `{ subject_id, academic_group_id }` pairs for their active Endodontics contexts. It rejects other roles and query parameters and sends `Cache-Control: no-store`.

## Draft endpoints

All endpoints are authenticated. The server reloads the caller's permissions for the active role.

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/endodontics-drafts` | Create an incomplete draft; requires `endodontics-drafts:write` and student role. |
| `GET` | `/endodontics-drafts` | List drafts visible under the caller's current access; requires `endodontics-drafts:read`. |
| `GET` | `/endodontics-drafts/:id` | Read a visible draft; requires `endodontics-drafts:read`. |
| `PATCH` | `/endodontics-drafts/:id` | Replace the full content of the author's draft if `expected_version` still matches; requires `endodontics-drafts:write` and student role. |

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

## Errors

Errors use `{ "error": { "code": "...", "message": "..." } }`.

- `400 BAD_REQUEST`: invalid body/UUID/version syntax, unknown fields, invalid types/options, text bounds, or pain outside integer 0–10. Examples include `pain.intensity must be an integer from 0 to 10, or null`, `patient_history.medication must be boolean or null`, and `unknown content section: patient_name`.
- `401 UNAUTHORIZED`: authentication is missing/invalid or a verified UUID actor is unavailable.
- `403 FORBIDDEN`: missing permission (for example `Permission 'endodontics-drafts:read' required`) or a role cannot perform the operation (`student author role required`).
- `404 NOT_FOUND`: draft is missing or outside the reader's live context (`endodontics draft was not found`); an unavailable patient returns `patient was not found`.
- `409 CONFLICT`: stale version (`draft version changed; reload before saving`).
- Unexpected failures return a generic `500 INTERNAL_SERVER_ERROR`.

## Deferred / out of scope

No automatic diagnosis, combinations validation, severity/category calculation, copied identity/demographics, demographic edits, or changes to other patient histories. No signed patient authorization, signatures/dates, treatment report, per-tooth/per-canal treatment measurements, procedures, attendance, discharge, return visit, submissions, or clinical-completeness gate. No screen or deployment/publishing work is included.
