# Patient assignment report API

`GET /reports/assignments?from=2026-11-01&to=2026-11-30` requires an authenticated active `admin` role with `assignment-reports:read` (migration 063).

Both dates are required, inclusive and formatted as `YYYY-MM-DD`. The range may include up to 366 calendar days, interpreted in Paraguay time (`America/Asuncion`). Invalid, repeated and unknown parameters return 400. Missing authentication returns 401; an authenticated caller without the role or permission gets 403.

Each assignment counts once on its `assigned_at` date, including ended or replaced assignments. The group is taken from the assignment's original student habilitation. Counts are not unique patient counts.

A successful response uses `Cache-Control: no-store` and contains `total` plus `items`, ordered by career code, subject ID and group ID. Each item includes only `career`, `subject_id`, `academic_group_id` and `assignment_count`. Empty results are `{"total":0,"items":[]}`. No personal or clinical fields are returned.
