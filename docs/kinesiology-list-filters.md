# Kinesiology list filters

Both Kinesiology clinical list endpoints keep `patient_id` required and preserve their existing authorization, patient/context scope, and ordering. Filters are optional and combine with the existing `subject_id` and `academic_group_id` filters.

## Endpoints

| Endpoint | Optional filters |
|---|---|
| `GET /kinesiology-evaluations` | `status`, `date_from`, `date_to` |
| `GET /kinesiology-evolutions` | `status`, `date_from`, `date_to`, `evaluation_id` |

`status` accepts only `draft`, `submitted`, or `validated`. `evaluation_id` is a positive PostgreSQL BIGINT decimal string and is available only on the evolutions list. Existing required patient and optional subject/group UUID validation is unchanged.

## Date behavior and validation

Dates use strict real `YYYY-MM-DD` calendar values from years `0001` through `9999` and UTC inclusive days. Year `0000` is rejected because PostgreSQL `date` does not support it. Either endpoint can be supplied independently; when both are supplied, `date_from` must not follow `date_to`. Duplicate query parameters, arrays/objects, impossible dates, malformed values, and reversed ranges return HTTP 400 before repository access. For example:

```http
GET /kinesiology-evolutions?patient_id=<uuid>&status=validated&date_from=2024-02-29&date_to=2024-03-01&evaluation_id=42
```

The dates are applied to the timestamp the reader is allowed to see: origin readers use the record's creation time; cross-context readers use the latest visible submitted snapshot time. Likewise, `status` filters the projected status (the snapshot-derived submitted/validated state for cross-context readers), never hidden draft status. These visible projections retain clinical snapshot privacy.

## Validation errors

Invalid filters return HTTP 400 with `{ "error": { "code": "BAD_REQUEST", "message": "..." } }` before repository access:

| Invalid input | Message |
|---|---|
| Missing, repeated, array, or object value for a supplied scalar filter | `<field> must be a single string` (where applicable; `patient_id` retains its existing UUID message) |
| Invalid calendar date, including year `0000` | `<date_from|date_to> must be a real YYYY-MM-DD date` |
| Reversed date range | `date_from must not be after date_to` |
| Unknown status | `status must be draft, submitted, or validated` |
| Invalid, zero, or out-of-range `evaluation_id` | `evaluation_id must be a positive BIGINT decimal string` |

When filters are omitted, the existing list response, permissions, patient requirement, SQL scope, order, and pagination behavior remain unchanged. Invalid filter requests are rejected without querying or mutating persistence.
