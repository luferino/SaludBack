# Patient registry API

The patient registry provides a general administrator listing and a separate career-scoped Reception listing. Patient creation remains governed by its existing write permission; listing access does not grant or change write access.

## Administrator listing

`GET /patients` requires an authenticated user with role `admin` (`AdminGuard`). It is independent of `patients:write`, which continues to guard `POST /patients`; permissions on a token do not let another role access the general registry.

| Query | Behavior |
|---|---|
| `q` | Optional, trimmed, case-insensitive literal substring over document, given names, or surnames. `%`, `_`, and backslash are literal characters. Blank/whitespace-only means no text filter. |
| `limit` | Optional integer, default `50`, range `1–100`. |
| `offset` | Optional integer, default `0`, range `0–10000`. |

Each parameter may appear once. Unknown/repeated parameters, malformed or out-of-range pagination, and `q` longer than 100 characters return `400 BAD_REQUEST`. Results are ordered by surname, given names, then ID. The response is `{ "items": [...], "limit": 50, "offset": 0 }`; each item contains exactly `id`, `documento`, `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo`, `direccion`, `marital_status`, and `medical_insurance`. Audit fields and totals are omitted. Responses use `Cache-Control: no-store`.

## Reception listing

`GET /reception/patients?career=kinesiology` or `?career=odontology` requires the Reception patient-management permission and an active grant for the selected career. The grant is checked live in the scoped operation; only patients enrolled in that career are listed. It accepts the same `q`, `limit`, and `offset` semantics and validation above, except `limit` defaults to `100` to preserve the existing Reception behavior. `career` is required and unique. Results retain surname/given-name/ID order and the same patient projection as the administrator listing (the nine identity/contact fields plus `marital_status` and `medical_insurance`), with additive `limit` and `offset` metadata. An inactive or revoked career grant remains denied; search never broadens career scope.

## Patient creation

`POST /patients` requires the existing `patients:write` permission and returns the creation DTO, including its established creator attribution. The new administrator listing neither bypasses nor alters this guard.

Both personal-data fields are optional on creation. An omitted field is stored as `null` (not recorded). An invalid value returns `400 BAD_REQUEST` before any duplicate-documento lookup:

- `marital_status` must be `single`, `married`, `divorced`, `widowed`, `civil_union`, or `null`. Otherwise: `marital_status must be single, married, divorced, widowed, civil_union or null`.
- `medical_insurance` must be `ips`, `police_health`, `military_health`, `none`, or `null`. Otherwise: `medical_insurance must be ips, police_health, military_health, none or null`.

`none` means declared without insurance; `null` means not recorded.

## Personal data update

`PATCH /patients/:id` changes only `marital_status` and `medical_insurance` on the shared patient record. It requires the `patients:write` permission and the `admin` role (`AdminGuard`). The same token values and messages as creation apply.

- A field that is omitted keeps its stored value; `null` clears it. Every write sets `updated_by` and `updated_at`.
- Any other key returns `400 BAD_REQUEST`: `allowed fields: marital_status, medical_insurance`.
- A non-object body (including an array) returns `400`: `body must be an object`.
- A body with no recognized key returns `400`: `at least one of marital_status or medical_insurance is required`.
- A malformed `:id` returns `400`: `id must be a UUID`.
- An unknown patient returns `404 NOT_FOUND`: `patient was not found`.
- A success returns `200` with the 13-key patient DTO: the 11 creation/listing keys plus `marital_status` and `medical_insurance`. Audit fields are not serialized.
