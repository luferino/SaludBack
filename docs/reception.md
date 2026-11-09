# Reception access (T1)

Reception accounts can only read their own active career options at this stage. An administrator provisions accounts and grants each career separately; no patient, clinical, assignment, academic-catalog, or general user-management permissions are granted to Reception.

## API contracts

All endpoints require a verified bearer token. Authentication applies only to matched handlers, preserving existing unknown-route responses. Account fields must be strings when present; malformed types, invalid credentials/career codes, and malformed path UUIDs return 400 before persistence. Duplicate usernames or emails return 409; granting an unknown account/career or revoking an unknown grant returns 404. Admin and self operations require a verified UUID actor/subject. Admin mutations also require role `admin` and the indicated enforced permission; checks are performed inside the handler after authentication.

| Method and path | Access | Contract |
|---|---|---|
| `POST /auth/accounts` | Admin + `reception:accounts:write` | Body `{ "username", "password", "email" }`; creates a `reception` user and returns the user JSON without password/audit fields (201). Existing normalization, validation, hashing, and duplicate handling apply. |
| `GET /auth/accounts/:userId/careers` | Admin + `reception:careers:write` | Returns `{ "items": [...] }`, including active and revoked grant periods in grant-time order; an unknown user returns an empty list. |
| `POST /auth/accounts/:userId/careers` | Admin + `reception:careers:write` | Body `{ "career": "kinesiology" | "odontology" }`; creates a separately audited active grant (201). A duplicate active user/career grant returns 409. |
| `POST /auth/career-grants/:grantId/revoke` | Admin + `reception:careers:write` | Revokes a period; repeat requests return the original audit values (200). |
| `GET /reception/careers` | Reception + `reception:careers:read` | Returns `{ "careers": ["kinesiology", "odontology"] }` for the verified subject's active grants only. The database is queried on every request; zero active grants returns an empty array. |

Grant objects are `{ id, user_id, career, granted_by, granted_at, revoked_by, revoked_at }`. Actor and timestamps are server-owned; clients cannot supply them. Career granting verifies the target user has role `reception`. No implicit second-career grant exists.

## Revocation serialization contract

Future scoped patient operations must use `PgReceptionAccessRepository.withActiveCareerScope`: begin a READ COMMITTED transaction, lock and verify the Reception user row, lock and verify its active grant, then lock patient rows. READ COMMITTED rechecks grant eligibility when a concurrent revocation releases the grant lock; scoped callbacks are never replayed. Grant revocation locks/updates the grant row, so a scope check and revocation serialize on that grant; a failed scope check performs no callback and rolls back. Do not introduce global locks or invert the user → grant → patient lock order. The guarded disposable PostgreSQL integration test verifies both lock orderings: a scoped operation holds the grant until commit before revocation completes; a revocation holding the grant first causes the later scoped lookup to reject without invoking its callback. The corrected candidate passed 179/179 integration tests and 602/602 unit tests, with no skipped tests. The disposable database was removed after the run; the habitual database was not used.

The enforced Reception permission seed is intentionally limited to `profile:read` and `reception:careers:read`; account provisioning and grant operations are admin-only. Existing global permission guard behavior and `/auth/register` estudiante-only behavior are unchanged. Migration `045_create_reception_access.sql` adds audited grant periods and their active-period uniqueness constraint.
