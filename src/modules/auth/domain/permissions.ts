/**
 * Role -> permissions derivation, owned by the domain.
 * Naming convention: `<resource>:<action>`.
 * Future roles (e.g. medico, admin) add keys to this map.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  estudiante: Object.freeze(['profile:read', 'materias:read', 'turnos:read']),
});

export function permissionsForRole(role: string): readonly string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
