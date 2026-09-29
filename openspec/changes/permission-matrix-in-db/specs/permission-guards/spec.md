# Delta for Permission Guards

## MODIFIED Requirements

### Requirement: PG-001: Permission Matrix

The system MUST define the permission matrix in the database: the `permissions` table is the catalog of every permission with an `enforced` boolean, and the `role_permissions` table holds the role→permission grants with PRIMARY KEY `(role, permission)`. The catalog MUST be seeded by migrations with `users:write`, `students:write`, `teachers:write`, `patients:write`, and `profile:read` marked `enforced=true`, and `materias:read` and `turnos:read` marked `enforced=false`. Guards MUST only enforce permissions whose catalog entry has `enforced=true`; `materias:read` and `turnos:read` MUST remain inert claims: they MAY be granted and MAY appear in tokens, but no guard MUST enforce them. The seeded grants MUST include all four write permissions plus `profile:read` for the `admin` role, so admin access to protected routes is preserved without role-specific guard logic. No code constant defines the matrix; the database is the single source of truth.
(Previously: the matrix was pinned by the hardcoded `ROLE_PERMISSIONS` / `IMPLEMENTED_PERMISSIONS` constants in `permissions.ts`.)

#### Scenario: Admin owns every write permission

- GIVEN the seeded `role_permissions` grants for the `admin` role
- WHEN the grants are inspected
- THEN they include `users:write`, `students:write`, `teachers:write`, `patients:write`, and `profile:read`

#### Scenario: Inert claims never enforced

- GIVEN a role granted `materias:read` or `turnos:read` (catalog `enforced=false`)
- WHEN any protected route is called
- THEN no guard checks `materias:read` or `turnos:read`

#### Scenario: Grant added honored on the next request

- GIVEN a role's `role_permissions` grants gain a permission
- WHEN a user of that role calls the protected route for it with an existing valid token
- THEN the request is granted without a re-login

#### Scenario: Grant removed denies the next request

- GIVEN a role's `role_permissions` grants lose a permission
- WHEN a user of that role calls the protected route for it with an existing valid token
- THEN the response is 403 `FORBIDDEN`

#### Scenario: Unknown role has no permissions

- GIVEN a role with no grants in `role_permissions`
- WHEN a protected request authenticates with that role
- THEN `req.auth.permissions` is empty
- AND any permission-requiring route responds 403 `FORBIDDEN`

#### Scenario: Inert catalog permission not required by any guard

- GIVEN a permission whose catalog entry has `enforced=false`
- WHEN the protected-route mappings are inspected
- THEN no route is mapped to it and no guard requires it