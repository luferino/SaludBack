import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ResetPassword } from '../../src/modules/auth/application/reset-password.usecase.ts';
import { PasswordResetToken } from '../../src/modules/auth/domain/password-reset-token.entity.ts';
import { BadRequestError } from '../../src/modules/shared/domain/errors.ts';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const VALID_RESET_TOKEN = new PasswordResetToken({
  id: 'token-uuid',
  userId: 'uuid-1',
  tokenHash: sha256('raw-secret-token'),
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
});

function createFakes({ resetToken = VALID_RESET_TOKEN } = {}) {
  const calls = { findValidByHash: [], hash: [], markUsed: [], updatePassword: [] };
  const resetTokenRepository = {
    async findValidByHash(tokenHash) {
      calls.findValidByHash.push(tokenHash);
      return resetToken;
    },
    async markUsed(id) {
      calls.markUsed.push(id);
    },
  };
  const repository = {
    async updatePassword(userId, newPasswordHash) {
      calls.updatePassword.push([userId, newPasswordHash]);
    },
  };
  const hasher = {
    async hash(plain) {
      calls.hash.push(plain);
      return `hashed:${plain}`;
    },
  };
  return { repository, resetTokenRepository, hasher, calls };
}

test('valid token: looks up by sha256, marks used, then replaces the password hash', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  const result = await useCase.execute({ token: 'raw-secret-token', newPassword: 'new-secret' });

  assert.deepEqual(result, { message: 'Password has been reset' });
  assert.equal(fakes.calls.findValidByHash[0], sha256('raw-secret-token'));
  assert.equal(fakes.calls.hash[0], 'new-secret');
  assert.equal(fakes.calls.markUsed[0], 'token-uuid');
  assert.deepEqual(fakes.calls.updatePassword[0], ['uuid-1', 'hashed:new-secret']);
});

test('markUsed runs before updatePassword (design D8)', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  const order = [];
  const originalMarkUsed = fakes.resetTokenRepository.markUsed;
  const originalUpdatePassword = fakes.repository.updatePassword;
  fakes.resetTokenRepository.markUsed = async (id) => {
    order.push('markUsed');
    await originalMarkUsed(id);
  };
  fakes.repository.updatePassword = async (userId, hash) => {
    order.push('updatePassword');
    await originalUpdatePassword(userId, hash);
  };

  await useCase.execute({ token: 'raw-secret-token', newPassword: 'new-secret' });

  assert.deepEqual(order, ['markUsed', 'updatePassword']);
});

test('unknown, used, or expired token throws one generic error and never touches the password', async () => {
  const fakes = createFakes({ resetToken: null });
  const useCase = new ResetPassword(fakes);

  await assert.rejects(
    () => useCase.execute({ token: 'raw-secret-token', newPassword: 'new-secret' }),
    (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.message, 'Invalid or expired reset token');
      return true;
    },
  );
  assert.equal(fakes.calls.markUsed.length, 0);
  assert.equal(fakes.calls.updatePassword.length, 0);
});

test('missing or empty token throws BadRequestError without looking up', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  await assert.rejects(() => useCase.execute({ newPassword: 'new-secret' }), BadRequestError);
  await assert.rejects(() => useCase.execute({ token: '   ', newPassword: 'new-secret' }), BadRequestError);
  assert.equal(fakes.calls.findValidByHash.length, 0);
});

test('missing or empty newPassword throws BadRequestError without looking up', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  await assert.rejects(() => useCase.execute({ token: 'raw-secret-token' }), BadRequestError);
  await assert.rejects(() => useCase.execute({ token: 'raw-secret-token', newPassword: '' }), BadRequestError);
  assert.equal(fakes.calls.findValidByHash.length, 0);
});
