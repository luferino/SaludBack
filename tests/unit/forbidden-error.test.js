import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenError, AppError } from '../../src/modules/shared/domain/errors.ts';

test('ForbiddenError carries status 403 and the stable FORBIDDEN code', () => {
  const error = new ForbiddenError();
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'FORBIDDEN');
  assert.ok(error instanceof AppError);
});

test('ForbiddenError keeps a custom message', () => {
  const error = new ForbiddenError('admin role required');
  assert.equal(error.message, 'admin role required');
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'FORBIDDEN');
});