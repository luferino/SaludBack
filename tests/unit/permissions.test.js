import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, permissionsForRole } from '../../src/modules/auth/domain/permissions.ts';

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

test('unknown roles yield no permissions', () => {
  assert.deepEqual(permissionsForRole('medico'), []);
});
