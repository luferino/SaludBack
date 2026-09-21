# Delta for Patient Registration

## MODIFIED Requirements

### Requirement: PAT-005: Admin-Only Guard

`POST /patients` MUST require a verified Bearer token holding the `patients:write` permission (token verified by `authenticate`, policy enforced by `PermissionGuard(patients:write)`). A missing, malformed, or expired token MUST respond 401 with the message `Invalid or missing token` and the create MUST NOT run; a verified token without `patients:write` MUST respond 403. The `admin` role owns `patients:write` via its seeded `role_permissions` grants, so admin access is unchanged.
(Previously: cited `ROLE_PERMISSIONS` as the source of the admin `patients:write` grant; the grant now comes from the seeded database matrix.)

#### Scenario: Expired token rejected

- GIVEN an expired Bearer token
- WHEN a client calls `POST /patients` with it
- THEN the response is 401 with the message `Invalid or missing token`
- AND no patient is created

#### Scenario: Token without patients:write rejected

- GIVEN a verified Bearer token whose `permissions` do not include `patients:write`
- WHEN a client calls `POST /patients` with it
- THEN the response is 403 `FORBIDDEN`
- AND no patient is created

#### Scenario: Admin token still accepted

- GIVEN a verified `admin` token and a valid payload
- WHEN `POST /patients` is called with it
- THEN the response is 201
- AND the row is persisted