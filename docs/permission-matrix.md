# Permission matrix snapshot

`GET /auth/permission-matrix` returns a read-only JSON snapshot for an authenticated, currently active Admin:

```json
{
  "permissions": [{ "permission": "profile:read", "enforced": true }],
  "roles": [{ "role": "admin", "permissions": ["profile:read"] }]
}
```

`permissions` lists the complete `permissions` catalog, including entries with no role assignments, and preserves each catalog `enforced` flag. `roles` contains roles with at least one recorded assignment. Catalog entries, roles, and each role's assignments are returned in deterministic alphabetical order. The route reuses the existing authentication middleware and additionally validates current Admin membership through the live role-grant repository. Unauthenticated requests receive 401; non-Admin roles receive 403; an Admin identity that is no longer active receives 401. Responses use `Cache-Control: no-store`.

The snapshot is read in one projected catalog/assignment query. It does not include user/account records, grant history, credentials, or environment data. Existing point queries used to resolve permissions for authentication are unchanged. No data is written or cached.

Rollback is code-only: remove the snapshot route mount, route, snapshot port/repository method, tests, and this document. No migration, schema change, or stored data is introduced.
