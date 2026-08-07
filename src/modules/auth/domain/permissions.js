/**
 * Role -> permissions derivation, owned by the domain.
 * Naming convention: `<resource>:<action>`.
 * Future roles (e.g. medico, admin) add keys to this map.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  estudiante: Object.freeze(['profile:read', 'materias:read', 'turnos:read']),
});

/**
 * @param {string} role
 * @returns {readonly string[]} permissions granted to the role (empty for unknown roles)
 */
export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}
