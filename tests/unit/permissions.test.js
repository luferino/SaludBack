import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, permissionsForRole } from '../../src/modules/auth/domain/permissions.ts';
// Namespace import so the file still loads while IMPLEMENTED_PERMISSIONS
// does not exist yet (RED): missing named exports throw at link time.
import * as permissionsModule from '../../src/modules/auth/domain/permissions.ts';

test('estudiante role maps to a non-empty permissions array', () => {
  const permissions = ROLE_PERMISSIONS.estudiante;
  assert.ok(Array.isArray(permissions));
  assert.ok(permissions.length > 0);
  assert.ok(permissions.every((permission) => typeof permission === 'string'));
});

test('teacher role maps to a non-empty permissions array (AUTH-001)', () => {
  const permissions = ROLE_PERMISSIONS.teacher;
  assert.ok(Array.isArray(permissions));
  assert.ok(permissions.length > 0);
  assert.ok(permissions.every((permission) => typeof permission === 'string'));
});

test('permissions follow the <resource>:<action> naming', () => {
  for (const permission of ROLE_PERMISSIONS.estudiante) {
    assert.match(permission, /^[a-z]+:[a-z]+$/);
  }
});

test('teacher permissions follow the <resource>:<action> naming (AUTH-001)', () => {
  for (const permission of ROLE_PERMISSIONS.teacher) {
    assert.match(permission, /^[a-z]+:[a-z]+$/);
  }
});

test('admin role maps to an explicit management permission set', () => {
  const permissions = ROLE_PERMISSIONS.admin;
  assert.ok(Array.isArray(permissions));
  assert.ok(permissions.length > 0);
  assert.ok(permissions.every((permission) => typeof permission === 'string'));
  assert.ok(
    permissions.includes('users:write') &&
      permissions.includes('students:write') &&
      permissions.includes('teachers:write') &&
      permissions.includes('patients:write'),
    'admin carries the management permissions',
  );
});

test('admin permissions follow the <resource>:<action> naming', () => {
  for (const permission of ROLE_PERMISSIONS.admin) {
    assert.match(permission, /^[a-z]+:[a-z]+$/);
  }
});

test('unknown roles yield no permissions', () => {
  assert.deepEqual(permissionsForRole('medico'), []);
});

test('IMPLEMENTED_PERMISSIONS pins exactly the five enforceable permissions (PG-001)', () => {
  assert.deepEqual(
    [...permissionsModule.IMPLEMENTED_PERMISSIONS],
    ['users:write', 'students:write', 'teachers:write', 'patients:write', 'profile:read'],
  );
});

test('every implemented permission is granted to the admin role (PG-001)', () => {
  for (const permission of permissionsModule.IMPLEMENTED_PERMISSIONS) {
    assert.ok(
      ROLE_PERMISSIONS.admin.includes(permission),
      `admin role must own ${permission} so admin access stays unchanged`,
    );
  }
});

test('inert claims (materias:read / turnos:read) are never part of the implemented set (PG-001)', () => {
  const implemented = new Set(permissionsModule.IMPLEMENTED_PERMISSIONS);
  assert.ok(!implemented.has('materias:read'), 'materias:read is inert: no guard may enforce it');
  assert.ok(!implemented.has('turnos:read'), 'turnos:read is inert: no guard may enforce it');
  // The inert claims MAY still appear in ROLE_PERMISSIONS and in tokens.
  assert.ok(ROLE_PERMISSIONS.estudiante.includes('materias:read'));
  assert.ok(ROLE_PERMISSIONS.estudiante.includes('turnos:read'));
});

test('implemented permissions follow the <resource>:<action> naming', () => {
  for (const permission of permissionsModule.IMPLEMENTED_PERMISSIONS) {
    assert.match(permission, /^[a-z]+:[a-z]+$/);
  }
});
