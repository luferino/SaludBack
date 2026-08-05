import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgUserRepository } from '../../src/modules/auth/infrastructure/repositories/pg-user-repository.js';
import { User } from '../../src/modules/auth/domain/user.js';

function createFakePool(queryHandler) {
  return { query: queryHandler };
}

const CREATED_AT = new Date('2026-08-05T12:00:00Z');

test('findByUsername returns null when no user matches', async () => {
  const repo = new PgUserRepository(createFakePool(async () => ({ rows: [] })));
  assert.equal(await repo.findByUsername('ghost'), null);
});

test('findByUsername maps a database row to a User', async () => {
  const repo = new PgUserRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /FROM users WHERE username = \$\d+/);
      assert.deepEqual(params, ['jperez']);
      return {
        rows: [
          {
            id: 'uuid-1',
            username: 'jperez',
            password_hash: 'hashed-value',
            role: 'estudiante',
            created_at: CREATED_AT,
          },
        ],
      };
    }),
  );

  const user = await repo.findByUsername('jperez');
  assert.ok(user instanceof User);
  assert.equal(user.id, 'uuid-1');
  assert.equal(user.username, 'jperez');
  assert.equal(user.passwordHash, 'hashed-value');
  assert.equal(user.role, 'estudiante');
  assert.equal(user.createdAt, CREATED_AT);
});

test('create inserts the user and returns the persisted entity', async () => {
  const repo = new PgUserRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /INSERT INTO users/);
      assert.deepEqual(params, ['mperez', 'hashed-value', 'estudiante']);
      return {
        rows: [
          {
            id: 'uuid-2',
            username: 'mperez',
            password_hash: 'hashed-value',
            role: 'estudiante',
            created_at: CREATED_AT,
          },
        ],
      };
    }),
  );

  const user = await repo.create(
    new User({ username: 'mperez', passwordHash: 'hashed-value', role: 'estudiante' }),
  );
  assert.equal(user.id, 'uuid-2');
  assert.equal(user.username, 'mperez');
  assert.equal(user.createdAt, CREATED_AT);
});

test('toJSON never exposes the password hash', () => {
  const user = new User({
    id: 'uuid-3',
    username: 'jperez',
    passwordHash: 'secret-hash',
    role: 'estudiante',
    createdAt: CREATED_AT,
  });
  const json = user.toJSON();
  assert.equal(json.passwordHash, undefined);
  assert.equal(json.username, 'jperez');
  assert.equal(JSON.stringify(user).includes('secret-hash'), false);
});
