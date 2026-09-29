import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgPermissionMatrixRepository } from '../../src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts';

function createFakePool(queryHandler) {
  return { query: queryHandler };
}

test('permissionsForRole queries role_permissions by role with a parameterized point query', async () => {
  const repo = new PgPermissionMatrixRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /FROM role_permissions WHERE role = \$\d+/);
      assert.match(text, /ORDER BY permission/);
      assert.deepEqual(params, ['estudiante']);
      return {
        rows: [
          { permission: 'profile:read' },
          { permission: 'materias:read' },
          { permission: 'turnos:read' },
        ],
      };
    }),
  );

  const permissions = await repo.permissionsForRole('estudiante');
  assert.deepEqual([...permissions], ['profile:read', 'materias:read', 'turnos:read']);
});

test('permissionsForRole maps rows in the database order (role_permissions ORDER BY permission)', async () => {
  const repo = new PgPermissionMatrixRepository(
    createFakePool(async () => ({
      rows: [{ permission: 'materias:read' }, { permission: 'profile:read' }],
    })),
  );

  const permissions = await repo.permissionsForRole('admin');
  assert.deepEqual([...permissions], ['materias:read', 'profile:read']);
});

test('permissionsForRole resolves to an empty array for an unknown role (no grants)', async () => {
  const repo = new PgPermissionMatrixRepository(createFakePool(async () => ({ rows: [] })));
  const permissions = await repo.permissionsForRole('medico');
  assert.ok(Array.isArray(permissions));
  assert.deepEqual([...permissions], []);
});

test('permissionsForRole propagates pool failures unchanged (fail closed)', async () => {
  const dbError = new Error('connection refused');
  const repo = new PgPermissionMatrixRepository(
    createFakePool(async () => {
      throw dbError;
    }),
  );

  await assert.rejects(() => repo.permissionsForRole('admin'), dbError);
});