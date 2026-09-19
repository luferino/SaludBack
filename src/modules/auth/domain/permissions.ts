/**
 * Role -> permissions derivation, owned by the domain.
 * Naming convention: `<resource>:<action>`.
 * Future roles (e.g. medico, admin) add keys to this map.
 * `teacher` mirrors the estudiante shape (AUTH-001); its values stay
 * TBD until the teacher permission matrix is pinned by a spec.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  estudiante: Object.freeze(['profile:read', 'materias:read', 'turnos:read']),
  teacher: Object.freeze(['profile:read', 'materias:read', 'turnos:read']),
  admin: Object.freeze([
    'users:write',
    'students:write',
    'teachers:write',
    'patients:write',
    'profile:read',
    'materias:read',
    'turnos:read',
  ]),
});

/**
 * The permission matrix actually enforced by guards (PG-001). Guards may
 * only require permissions listed here; `materias:read` and `turnos:read`
 * stay inert claims — they MAY appear in `ROLE_PERMISSIONS` and in tokens,
 * but no guard MUST enforce them (teacher matrix still TBD by spec).
 */
export const IMPLEMENTED_PERMISSIONS: readonly string[] = Object.freeze([
  'users:write',
  'students:write',
  'teachers:write',
  'patients:write',
  'profile:read',
]);

export function permissionsForRole(role: string): readonly string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
