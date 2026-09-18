import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Guard, OpenGuard, AdminGuard, PermissionGuard } from '../../src/modules/shared/application/guard.ts';
import { UnauthorizedError, ForbiddenError } from '../../src/modules/shared/domain/errors.ts';

test('OpenGuard allows any request (seam open by default)', async () => {
  const guard = new OpenGuard();
  await assert.doesNotReject(() => guard.authorize({}));
});

test('Guard base class fails loudly when authorize is not implemented', async () => {
  const guard = new Guard();
  await assert.rejects(() => guard.authorize({}), /must be implemented by a subclass/);
});

test('a policy guard rejects the request before the use case runs', async () => {
  class AdminGuard extends Guard {
    async authorize() {
      throw new UnauthorizedError();
    }
  }
  await assert.rejects(() => new AdminGuard().authorize({}), UnauthorizedError);
});

test('AdminGuard rejects a request with no req.auth as UnauthorizedError (401)', async () => {
  const guard = new AdminGuard();
  await assert.rejects(
    () => guard.authorize({}),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.statusCode, 401);
      return true;
    },
  );
});

test('AdminGuard rejects a non-admin role with ForbiddenError (403)', async () => {
  const guard = new AdminGuard();
  for (const role of ['estudiante', 'teacher', 'medico']) {
    await assert.rejects(
      () => guard.authorize({ auth: { role, permissions: [] } }),
      (error) => {
        assert.ok(error instanceof ForbiddenError);
        assert.equal(error.statusCode, 403);
        return true;
      },
    );
  }
});

test('AdminGuard allows a request whose verified role is admin', async () => {
  const guard = new AdminGuard();
  await assert.doesNotReject(() =>
    guard.authorize({ auth: { role: 'admin', permissions: ['users:write'] } }),
  );
});

test('PermissionGuard rejects a request with no req.auth as UnauthorizedError (401)', async () => {
  const guard = new PermissionGuard('profile:read');
  await assert.rejects(
    () => guard.authorize({}),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, 'UNAUTHORIZED');
      return true;
    },
  );
});

test('PermissionGuard rejects a request missing the required permission with ForbiddenError (403)', async () => {
  const guard = new PermissionGuard('profile:read');
  for (const permissions of [[], ['users:write'], ['materias:read']]) {
    await assert.rejects(
      () => guard.authorize({ auth: { role: 'estudiante', permissions } }),
      (error) => {
        assert.ok(error instanceof ForbiddenError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.code, 'FORBIDDEN');
        return true;
      },
    );
  }
});

test('PermissionGuard allows a request whose permissions include the required permission', async () => {
  const guard = new PermissionGuard('profile:read');
  await assert.doesNotReject(() =>
    guard.authorize({ auth: { role: 'estudiante', permissions: ['profile:read'] } }),
  );
});

test('PermissionGuard enforces exactly the configured permission, not any other', async () => {
  const guard = new PermissionGuard('students:write');
  await assert.doesNotReject(() =>
    guard.authorize({ auth: { role: 'admin', permissions: ['users:write', 'students:write'] } }),
  );
  await assert.rejects(
    () =>
      guard.authorize({ auth: { role: 'admin', permissions: ['users:write', 'profile:read'] } }),
    ForbiddenError,
  );
});
