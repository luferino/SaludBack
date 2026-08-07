import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Guard, OpenGuard } from '../../src/modules/shared/application/guard.js';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.js';

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
