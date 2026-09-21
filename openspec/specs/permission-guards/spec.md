# Permission Guards Specification

## Purpose

Makes the permission system enforceable. A shared `PermissionGuard` implements the same `Guard` port as `AdminGuard`, mounts after `authenticate`, and rejects with 403 when the required permission is absent from `req.auth.permissions`. The four protected write mounts plus `GET /auth/me` migrate from the admin-role gate to permission gates with observable 401/403 outcomes identical to today. The permission matrix is pinned so only implemented permissions are enforced.

## Requirements

### Requirement: PG-001: Permission Matrix

The system MUST pin the permission matrix to these implemented permissions: `users:write`, `students:write`, `teachers:write`, `patients:write`, and `profile:read`. `materias:read` and `turnos:read` MUST remain inert claims: they MAY appear in the seeded `role_permissions` table and in tokens, but no guard MUST enforce them. The seeded `role_permissions` table MUST grant the `admin` role all four write permissions plus `profile:read`, so admin access to protected routes is preserved without role-specific guard logic.

#### Scenario: Admin owns every write permission

- GIVEN the `admin` entry in the seeded `role_permissions` table
- WHEN the entry is inspected
- THEN it includes `users:write`, `students:write`, `teachers:write`, `patients:write`, and `profile:read`

#### Scenario: Inert claims never enforced

- GIVEN a role whose permissions include `materias:read` or `turnos:read`
- WHEN any protected route is called
- THEN no guard checks `materias:read` or `turnos:read`

### Requirement: PG-002: PermissionGuard Contract

A `PermissionGuard` SHALL be implemented in shared infrastructure beside `AdminGuard`, SHALL implement the same `Guard` port, and SHALL be mounted after `authenticate`. The guard MUST reject with 401 `UNAUTHORIZED` when `req.auth` is absent and MUST reject with 403 `FORBIDDEN` when the required permission is missing from `req.auth.permissions`; otherwise it MUST let the request proceed. A 401 or 403 MUST prevent the route handler from executing and MUST NOT run the use case or persist anything.

#### Scenario: Unauthenticated rejected

- GIVEN a request with no token or an invalid token
- WHEN a protected route is called
- THEN the response is 401 `UNAUTHORIZED`
- AND the handler does not run

#### Scenario: Missing permission rejected

- GIVEN a verified Bearer token whose `permissions` do not include the required permission
- WHEN the protected route is called with it
- THEN the response is 403 `FORBIDDEN`
- AND the handler does not run

#### Scenario: Permission present proceeds

- GIVEN a verified Bearer token whose `permissions` include the required permission
- WHEN the protected route is called with it
- THEN the request proceeds to the handler

### Requirement: PG-003: Protected Route Mapping

Each protected mount MUST enforce exactly its mapped permission:

| Route | Permission |
|---|---|
| `POST /auth/register` | `users:write` |
| `POST /students` | `students:write` |
| `POST /teachers` | `teachers:write` |
| `POST /patients` | `patients:write` |
| `GET /auth/me` | `profile:read` |

For every migrated route, observable outcomes MUST be identical to pre-migration behavior: unauthenticated requests respond 401 `UNAUTHORIZED`, verified tokens without the mapped permission respond 403 `FORBIDDEN`, and `admin` tokens (which hold every permission) succeed as before.

#### Scenario: Admin preserved on every mount

- GIVEN a verified `admin` token
- WHEN each of the five protected mounts is called with a valid payload
- THEN the four write mounts respond 201 and `GET /auth/me` responds 200

#### Scenario: Non-admin write mount rejected

- GIVEN a verified `estudiante` token whose `permissions` do not include `students:write`
- WHEN `POST /students` is called with it
- THEN the response is 403 `FORBIDDEN`
- AND nothing is persisted