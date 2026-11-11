# Patient registry API

The patient registry provides a general administrator listing and a separate career-scoped Reception listing. Patient creation remains governed by its existing write permission; listing access does not grant or change write access.

## Administrator listing

`GET /patients` requires an authenticated user with role `admin` (`AdminGuard`). It is independent of `patients:write`, which continues to guard `POST /patients`; permissions on a token do not let another role access the general registry.

| Query | Behavior |
|---|---|
| `q` | Optional, trimmed, case-insensitive literal substring over document, given names, or surnames. `%`, `_`, and backslash are literal characters. Blank/whitespace-only means no text filter. |
| `limit` | Optional integer, default `50`, range `1–100`. |
| `offset` | Optional integer, default `0`, range `0–10000`. |

Each parameter may appear once. Unknown/repeated parameters, malformed or out-of-range pagination, and `q` longer than 100 characters return `400 BAD_REQUEST`. Results are ordered by surname, given names, then ID. The response is `{ "items": [...], "limit": 50, "offset": 0 }`; each item contains exactly `id`, `documento`, `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo`, and `direccion`. Audit fields and totals are omitted. Responses use `Cache-Control: no-store`.

## Reception listing

`GET /reception/patients?career=kinesiology` or `?career=odontology` requires the Reception patient-management permission and an active grant for the selected career. The grant is checked live in the scoped operation; only patients enrolled in that career are listed. It accepts the same `q`, `limit`, and `offset` semantics and validation above, except `limit` defaults to `100` to preserve the existing Reception behavior. `career` is required and unique. Results retain surname/given-name/ID order and the same nine-field patient projection, with additive `limit` and `offset` metadata. An inactive or revoked career grant remains denied; search never broadens career scope.

## Patient creation

`POST /patients` remains unchanged: it requires the existing `patients:write` permission and returns the existing creation DTO, including its established creator attribution. The new administrator listing neither bypasses nor alters this guard.
