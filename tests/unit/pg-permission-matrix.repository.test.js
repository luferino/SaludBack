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

test('readSnapshot issues one ordered, projected catalog-assignment query and maps roles and explicit flags', async () => {
  let queryCount = 0;
  const repo = new PgPermissionMatrixRepository(createFakePool(async (text, params) => {
    queryCount++;
    assert.equal(params, undefined);
    assert.match(text, /SELECT\s+p\.permission, p\.enforced, rp\.role/);
    assert.match(text, /LEFT JOIN role_permissions/);
    assert.match(text, /ORDER BY p\.permission, rp\.role/);
    assert.doesNotMatch(text, /SELECT \*|users|user_role_grants/i);
    return { rows: [
      { permission: 'accounts:read', enforced: false, role: null },
      { permission: 'careers:read', enforced: true, role: 'teacher' },
      { permission: 'profile:read', enforced: true, role: 'admin' },
      { permission: 'profile:read', enforced: true, role: 'teacher' },
    ] };
  }));

  assert.deepEqual(await repo.readSnapshot(), {
    permissions: [
      { permission: 'accounts:read', enforced: false },
      { permission: 'careers:read', enforced: true },
      { permission: 'profile:read', enforced: true },
    ],
    roles: [
      { role: 'admin', permissions: ['profile:read'] },
      { role: 'teacher', permissions: ['careers:read', 'profile:read'] },
    ],
  });
  assert.equal(queryCount, 1);
});

test('readSnapshot maps an empty assignment query to empty arrays and propagates failures', async () => {
  const empty = new PgPermissionMatrixRepository(createFakePool(async () => ({ rows: [] })));
  assert.deepEqual(await empty.readSnapshot(), { permissions: [], roles: [] });

  const dbError = new Error('snapshot unavailable');
  const failing = new PgPermissionMatrixRepository(createFakePool(async () => { throw dbError; }));
  await assert.rejects(() => failing.readSnapshot(), error => error === dbError);
});
