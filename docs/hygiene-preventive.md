# Hygiene and Preventive Dentistry II clinical drafts

Hygiene and Preventive Dentistry II is an Odontology-specific form. Patient identity and the longitudinal clinical record remain shared; its clinical content is independent of the Oral Surgery and Kinesiology APIs.

This first delivery covers subject configuration. Clinical drafts (medical history, FDI odontogram and caries indices) follow in the next slice. Plaque indices (Löe-Silness, O'Leary), the procedure log with teacher signature, informed consent, marital status and medical insurance are later deliveries.

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
