# Active-role persistence (B1)

This slice adds persistence for audited additional Reception-role grants. Existing career scopes remain separate. It does not mount or activate a production consumer: authentication, role discovery/switching, administration, and Reception runtime integration arrive in later slices.

## Persistence facts

- Additional Reception grants are audited periods, with at most one active grant per user. Grant/revoke records identify their verified actors and timestamps.
- Only eligible Student identities can receive an additional Reception grant. A role grant does not create or modify a user, profile, permission catalog, or primary role.
- Career eligibility is stored separately and must be explicitly granted. Adding Reception does not grant a career, assignment, or clinical access; patient assignment remains teacher-owned.
- Revocation closes the active grant period and follows the repository's user → role-grant → career-grant locking order. Replay of an earlier revocation does not revoke a later grant or its careers.
- Existing primary roles and their permission seeds remain unchanged. The persisted grant data is inert until later slices connect runtime authorization consumers.

General role/catalog maintenance remains outside this feature. Subsequent slices add the approved admin APIs and runtime authorization; this slice mounts neither.
