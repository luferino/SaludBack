# Oral Surgery draft-list filters

The Oral Surgery drafts endpoint accepts optional inclusive UTC date bounds without changing its existing visibility, patient selection, or pagination behavior.

## Quick path

```http
GET /oral-surgery-drafts?patient_id=<uuid>&date_from=2024-02-29&date_to=2024-03-01&limit=50&offset=0
```

- `patient_id` remains optional.
- `date_from` includes the start of that UTC calendar day.
- `date_to` includes the entire end day (the SQL upper bound is the next UTC midnight, exclusive).
- Either date endpoint can be used independently.

## Filter rules

| Query key | Behavior |
|---|---|
| `date_from`, `date_to` | Strict real `YYYY-MM-DD` dates, compared to `e.created_at` using inclusive UTC calendar days. |
| `patient_id` | Existing optional UUID filter. |
| `subject_id`, `academic_group_id` | Existing optional UUID filters. |
| `limit`, `offset` | Existing bounds and defaults are unchanged (`50` and `0`). |
| Any other key | Rejected with HTTP 400; there is no status filter. |

Duplicate values (including repeated query keys), arrays/objects, malformed or impossible dates, and ranges where `date_from` is after `date_to` return HTTP 400 before repository access. Omitting both date keys preserves the previous result scope, descending ID order, projection, and pagination.

Date conditions only restrict rows already visible through the existing `READ_ACCESS` role/context policy. They inspect the visible draft's `created_at`; they do not reveal or filter other clinical draft data. Existing read permission checks remain required.
