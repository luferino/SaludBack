import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgResetTokenRepository } from '../../src/modules/auth/infrastructure/repositories/pg-reset-token.repository.ts';
import { PasswordResetToken } from '../../src/modules/auth/domain/password-reset-token.entity.ts';

function createFakePool(queryHandler) {
  return { query: queryHandler };
}

const EXPIRES_AT = new Date('2026-08-15T13:00:00Z');
const CREATED_AT = new Date('2026-08-15T12:00:00Z');

test('create runs the atomic cap+insert statement with user, token and cap params', async () => {
  let captured;
  const repo = new PgResetTokenRepository(
    createFakePool(async (text, params) => {
      captured = { text, params };
      return {
        rows: [
          {
            id: 'token-uuid',
            user_id: 'uuid-1',
            token_hash: 'hashed-token',
            expires_at: EXPIRES_AT,
            used_at: null,
            created_at: CREATED_AT,
          },
        ],
      };
    }),
    3,
  );

  const token = await repo.create({
    userId: 'uuid-1',
    tokenHash: 'hashed-token',
    expiresAt: EXPIRES_AT,
  });

  assert.match(captured.text, /INSERT INTO password_reset_tokens/);
  assert.match(captured.text, /VALUES \(\$1, \$2, \$3\)/);
  assert.match(captured.text, /used_at IS NULL/);
  assert.match(captured.text, /ORDER BY created_at DESC, id DESC/);
  assert.match(captured.text, /OFFSET \$4 - 1/);
  assert.deepEqual(captured.params, ['uuid-1', 'hashed-token', EXPIRES_AT, 3]);

  assert.ok(token instanceof PasswordResetToken);
  assert.equal(token.id, 'token-uuid');
  assert.equal(token.userId, 'uuid-1');
  assert.equal(token.tokenHash, 'hashed-token');
  assert.equal(token.expiresAt, EXPIRES_AT);
  assert.equal(token.usedAt, null);
  assert.equal(token.createdAt, CREATED_AT);
});

test('findValidByHash returns null when no valid token matches', async () => {
  const repo = new PgResetTokenRepository(createFakePool(async () => ({ rows: [] })), 3);
  assert.equal(await repo.findValidByHash('unknown-hash'), null);
});

test('findValidByHash only accepts unused, unexpired tokens and maps the row', async () => {
  let captured;
  const repo = new PgResetTokenRepository(
    createFakePool(async (text, params) => {
      captured = { text, params };
      return {
        rows: [
          {
            id: 'token-uuid',
            user_id: 'uuid-1',
            token_hash: 'hashed-token',
            expires_at: EXPIRES_AT,
            used_at: null,
            created_at: CREATED_AT,
          },
        ],
      };
    }),
    3,
  );

  const token = await repo.findValidByHash('hashed-token');

  assert.match(captured.text, /WHERE token_hash = \$1 AND used_at IS NULL AND expires_at > now\(\)/);
  assert.deepEqual(captured.params, ['hashed-token']);
  assert.ok(token instanceof PasswordResetToken);
  assert.equal(token.id, 'token-uuid');
  assert.equal(token.userId, 'uuid-1');
  assert.equal(token.tokenHash, 'hashed-token');
});

test('markUsed marks the row used by id', async () => {
  let captured;
  const repo = new PgResetTokenRepository(
    createFakePool(async (text, params) => {
      captured = { text, params };
      return { rows: [] };
    }),
    3,
  );

  await repo.markUsed('token-uuid');

  assert.match(captured.text, /UPDATE password_reset_tokens SET used_at = now\(\) WHERE id = \$1/);
  assert.deepEqual(captured.params, ['token-uuid']);
});
