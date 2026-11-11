# Student and Reception active roles

A Student account can receive an audited additional Reception role and explicitly switch its active role. Identity remains the same account; each signed token contains one role's permissions, never a union. Primary-role login and the deliberately stored-primary `/auth/me` response stay unchanged.

## Runtime API

All runtime endpoints require a valid bearer token. Legacy tokens without an additional-role claim retain signature verification and fresh permission-matrix semantics; primary membership is checked locally by role discovery and switching. Additional Reception tokens require their exact live grant on every protected request, and permissions are always refreshed from the matrix.

| Method and path | Contract |
|---|---|
| `GET /auth/roles` | Returns `{ active_role, available_roles }`. The stored primary role is first; active additional Reception follows only while its grant is live. Other primary roles expose only themselves. |
| `POST /auth/active-role` | Accepts exactly `{ "role": "..." }`. A currently available role returns `{ "token": "..." }` with the same `sub` and `username` and only the target role's permission set. Malformed bodies return 400; an ungranted role returns 403. |
| `GET /auth/me` | Unchanged: exactly `{ username, email, role }` from the stored primary role, not the active role. |
| `POST /auth/login` | Unchanged `{ token }`; newly issued tokens use the stored primary role. |

An additional-Reception token carries `role: "reception"` and the exact `role_grant_id`. A primary-role token has no grant-instance claim. Previously issued tokens remain valid only while their own membership is valid: revocation rejects that exact token, including after a later regrant. Primary Reception accounts remain compatible and do not need an extra-role grant row. Additional-grant membership failures fail closed; database faults are not converted into authentication failures. Discovery and switching independently require the verified UUID identity's current primary or exact additional-role membership before listing or issuing a role token.

## Admin API

Every route requires a verified active `admin` token and the existing `reception:accounts:write` permission. Responses use the shared `{ "error": { "code", "message" } }` envelope. Mutations attribute audit fields to the verified token subject; clients cannot supply audit values.

| Method and path | Contract |
|---|---|
| `GET /auth/reception-role-candidates?q=...&limit=...&offset=...` | Required trimmed query `q` (1–100 UTF-16 code units); literal case-insensitive username/email substring search over Student-primary accounts only. Defaults: limit 20, offset 0; bounds: limit 1–100, offset 0–10000. Returns `{ items: [{ id, username, email }], limit, offset }`; no blank browse. Unknown, repeated, nested, malformed, or out-of-range query input returns 400. |
| `GET /auth/accounts/:userId/reception-role` | Student account's full grant history: `{ items: [roleGrant] }`. Missing/non-Student target returns 404. |
| `POST /auth/accounts/:userId/reception-role` | Accepts an empty body or `{}`; creates one audited Reception grant and returns its `roleGrant` (201). Invalid UUID returns 400, missing/non-Student target 404, and an already-active grant 409. |
| `POST /auth/reception-role-grants/:grantId/revoke` | Accepts an empty body or `{}`; idempotently revokes the exact grant and returns its `roleGrant` (200). Invalid UUID returns 400; unknown grant returns 404. |

A `roleGrant` has exactly `{ id, user_id, role, granted_by, granted_at, revoked_by, revoked_at }`; `role` is `reception`, timestamps are ISO strings or null. First revocation atomically closes active Reception career grants. Replaying an older revoked grant preserves its audit facts and cannot revoke later career grants. Role grants never create careers, users, or Student profiles; career access remains separate and requires explicit career grants. Career grants for a dual-role account serialize on its user row against role revocation.

## Persistence, scope, and rollout

Migration `048_create_user_role_grants.sql` adds audited grant periods with one-active-period uniqueness. It does not alter `users.role`, the permission catalog, or role-permission seeds. Existing primary-role accounts retain their login and active-role behavior.

Every Reception scoped operation uses the selected career and a transaction with this lock order: user, exact additional-role grant when present, career grant, then patient rows. This revalidates the token's grant instance inside the transaction; a role revoked while a request waits cannot authorize a later patient write. Primary Reception uses the stored primary role and existing career grant without an additional-role row.

The existing `GET /auth/accounts` lists primary Reception accounts and Students with an active additional Reception grant, with the same response shape. Pre-existing error responses keep their status and text: an ineligible career-grant target returns 404 `career was not found`, and a missing or non-Reception account without a grant-carrying token returns 404 `Reception account was not found`. A grant-carrying token whose grant is revoked, absent, or held by a non-Student account returns 401.

No role grant implicitly adds a career, assignment, or clinical permission. Reception remains limited to its existing career-scoped patient and availability tasks. Patient assignment remains teacher-owned; role switching does not grant clinical access. The additive role table is runtime authority only through the live membership checks and exact-instance transactional revalidation described above.
