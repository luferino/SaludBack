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

const VALID_NEW_PASSWORD = 'newSecret123';

test('valid token: looks up by sha256, marks used, then replaces the password hash', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  const result = await useCase.execute({ token: 'raw-secret-token', newPassword: VALID_NEW_PASSWORD });

  assert.deepEqual(result, { message: 'Password has been reset' });
  assert.equal(fakes.calls.findValidByHash[0], sha256('raw-secret-token'));
  assert.equal(fakes.calls.hash[0], VALID_NEW_PASSWORD);
  assert.equal(fakes.calls.markUsed[0], 'token-uuid');
  assert.deepEqual(fakes.calls.updatePassword[0], ['uuid-1', `hashed:${VALID_NEW_PASSWORD}`]);
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

  await useCase.execute({ token: 'raw-secret-token', newPassword: VALID_NEW_PASSWORD });

  assert.deepEqual(order, ['markUsed', 'updatePassword']);
});

test('unknown, used, or expired token throws one generic error and never touches the password', async () => {
  const fakes = createFakes({ resetToken: null });
  const useCase = new ResetPassword(fakes);

  await assert.rejects(
    () => useCase.execute({ token: 'raw-secret-token', newPassword: VALID_NEW_PASSWORD }),
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

  await assert.rejects(() => useCase.execute({ newPassword: VALID_NEW_PASSWORD }), BadRequestError);
  await assert.rejects(() => useCase.execute({ token: '   ', newPassword: VALID_NEW_PASSWORD }), BadRequestError);
  assert.equal(fakes.calls.findValidByHash.length, 0);
});

test('missing or empty newPassword throws BadRequestError without looking up', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  await assert.rejects(() => useCase.execute({ token: 'raw-secret-token' }), BadRequestError);
  await assert.rejects(() => useCase.execute({ token: 'raw-secret-token', newPassword: '' }), BadRequestError);
  assert.equal(fakes.calls.findValidByHash.length, 0);
});

test('newPassword too short throws BadRequestError', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  await assert.rejects(
    () => useCase.execute({ token: 'raw-secret-token', newPassword: 'short1' }),
    (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.message, 'password must be at least 10 characters');
      return true;
    },
  );
  assert.equal(fakes.calls.findValidByHash.length, 0);
});

test('newPassword without digit throws BadRequestError', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  await assert.rejects(
    () => useCase.execute({ token: 'raw-secret-token', newPassword: 'lettersonly' }),
    (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.message, 'password must contain at least one letter and one number');
      return true;
    },
  );
  assert.equal(fakes.calls.findValidByHash.length, 0);
});

test('newPassword without letter throws BadRequestError', async () => {
  const fakes = createFakes();
  const useCase = new ResetPassword(fakes);

  await assert.rejects(
    () => useCase.execute({ token: 'raw-secret-token', newPassword: '1234567890' }),
    (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.message, 'password must contain at least one letter and one number');
      return true;
    },
  );
  assert.equal(fakes.calls.findValidByHash.length, 0);
});
