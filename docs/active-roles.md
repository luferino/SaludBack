# Student and Reception active roles

This slice adds persistence for audited additional Reception-role grants. Existing career scopes remain separate. It mounts the admin APIs that grant and revoke the additional Reception role. It does not yet activate a runtime consumer: role discovery/switching and live-grant authentication arrive in the next slice, and Reception runtime integration arrives after that.

## Persistence facts

- Additional Reception grants are audited periods, with at most one active grant per user. Grant/revoke records identify their verified actors and timestamps.
- Only eligible Student identities can receive an additional Reception grant. A role grant does not create or modify a user, profile, permission catalog, or primary role.
- Career eligibility is stored separately and must be explicitly granted. Adding Reception does not grant a career, assignment, or clinical access; patient assignment remains teacher-owned.
- Revocation closes the active grant period and follows the repository's user → role-grant → career-grant locking order. Replay of an earlier revocation does not revoke a later grant or its careers.
- Existing primary roles and their permission seeds remain unchanged. The persisted grant data is inert until later slices connect runtime authorization consumers.

## Admin API

All routes are mounted under `/auth`. Each requires a verified active `admin` token and the existing `reception:accounts:write` permission. No permission or catalog entry is added. Errors use the shared `{ "error": { "code", "message" } }` envelope.

| Method and path | Contract |
|---|---|
| `GET /auth/reception-role-candidates?q=&limit=&offset=` | Bounded Student lookup. `q` is required and trimmed (1–100 characters), matched as a literal, case-insensitive substring of username or email. `limit` defaults to 20 (1–100); `offset` defaults to 0 (0–10000). Returns `{ items: [{ id, username, email }], limit, offset }`. No blank browsing. |
| `GET /auth/accounts/:userId/reception-role` | Full grant history for one Student account. Returns `{ items: [roleGrant] }`. |
| `POST /auth/accounts/:userId/reception-role` | Creates an active Reception grant. Body must be empty or `{}`. Returns `roleGrant` with 201. |
| `POST /auth/reception-role-grants/:grantId/revoke` | Revokes that exact grant. Body must be empty or `{}`. Returns `roleGrant` with 200. Idempotent. |

A `roleGrant` has exactly `{ id, user_id, role, granted_by, granted_at, revoked_by, revoked_at }`. `role` is `reception`; timestamps are ISO strings or `null`.

| Status | Cause |
|---|---|
| 400 | Unknown, repeated, or bracketed query keys; out-of-range `limit` or `offset`; non-UUID path id; body other than empty or `{}`. |
| 401 | Missing or invalid token. |
| 403 | Token lacks the `admin` role or `reception:accounts:write`. |
| 404 `NOT_FOUND` | Account is missing or not a Student, or grant is unknown. History for a non-Student target also returns 404. |
| 409 `CONFLICT` | Student already has an active Reception grant. |

- The audited actor is the verified token subject; clients cannot supply actor or audit fields.
- Only Student primary accounts can receive the Reception grant. Granting creates no user, profile, career, assignment, or clinical access.
- First revocation closes the grant and all active Reception career grants for that account. Replaying a revoked grant keeps its original audit facts and never revokes newer role or career grants.
- Writes lock in the user → role-grant → career-grant order.

## Scope

- Role discovery/switching and live-grant authentication arrive in the next slice. Until then, a granted Reception role is recorded but cannot be used for self-service switching.
- Existing account listings and career operations are unchanged in this slice.
- General role/catalog maintenance stays outside this feature.
