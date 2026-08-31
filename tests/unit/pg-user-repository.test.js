import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgUserRepository } from '../../src/modules/auth/infrastructure/repositories/pg-user.repository.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';

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
            email: 'jperez@example.com',
            created_at: CREATED_AT,
            created_by: null,
            updated_by: null,
            updated_at: null,
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
  assert.equal(user.email, 'jperez@example.com');
  assert.equal(user.createdAt, CREATED_AT);
  assert.equal(user.createdBy, null, 'no admin flow: created_by is NULL');
  assert.equal(user.updatedBy, null, 'creation leaves updated_by NULL');
  assert.equal(user.updatedAt, null, 'creation leaves updated_at NULL');
});

test('findByEmail returns null when no user matches', async () => {
  const repo = new PgUserRepository(createFakePool(async () => ({ rows: [] })));
  assert.equal(await repo.findByEmail('ghost@example.com'), null);
});

test('findByEmail maps a database row to a User', async () => {
  const repo = new PgUserRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /FROM users WHERE email = \$\d+/);
      assert.deepEqual(params, ['jperez@example.com']);
      return {
        rows: [
          {
            id: 'uuid-1',
            username: 'jperez',
            password_hash: 'hashed-value',
            role: 'estudiante',
            email: 'jperez@example.com',
            created_at: CREATED_AT,
            created_by: null,
            updated_by: null,
            updated_at: null,
          },
        ],
      };
    }),
  );

  const user = await repo.findByEmail('jperez@example.com');
  assert.ok(user instanceof User);
  assert.equal(user.id, 'uuid-1');
  assert.equal(user.email, 'jperez@example.com');
});

test('create inserts the user and returns the persisted entity', async () => {
  const repo = new PgUserRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /INSERT INTO users/);
      assert.deepEqual(params, [
        'mperez',
        'hashed-value',
        'estudiante',
        'mperez@example.com',
        null,
        null,
        null,
      ]);
      return {
        rows: [
          {
            id: 'uuid-2',
            username: 'mperez',
            password_hash: 'hashed-value',
            role: 'estudiante',
            email: 'mperez@example.com',
            created_at: CREATED_AT,
            created_by: null,
            updated_by: null,
            updated_at: null,
          },
        ],
      };
    }),
  );

  const user = await repo.create(
    new User({
      username: 'mperez',
      passwordHash: 'hashed-value',
      role: 'estudiante',
      email: 'mperez@example.com',
    }),
  );
  assert.equal(user.id, 'uuid-2');
  assert.equal(user.username, 'mperez');
  assert.equal(user.email, 'mperez@example.com');
  assert.equal(user.createdAt, CREATED_AT);
  assert.equal(user.createdBy, null);
});

test('create accepts an optional client and routes the INSERT through it, not the pool', async () => {
  let poolCalls = 0;
  const repo = new PgUserRepository(
    createFakePool(async () => {
      poolCalls += 1;
      throw new Error('must not touch the pool when a client is given');
    }),
  );
  const clientCalls = [];
  const client = {
    async query(text, params) {
      clientCalls.push([text, params]);
      return {
        rows: [
          {
            id: 'uuid-2',
            username: 'mperez',
            password_hash: 'hashed-value',
            role: 'estudiante',
            email: null,
            created_at: CREATED_AT,
            created_by: null,
            updated_by: null,
            updated_at: null,
          },
        ],
      };
    },
  };

  const user = await repo.create(
    new User({ username: 'mperez', passwordHash: 'hashed-value', role: 'estudiante', email: null }),
    client,
  );

  assert.equal(poolCalls, 0);
  assert.equal(clientCalls.length, 1);
  assert.match(clientCalls[0][0], /INSERT INTO users/);
  assert.deepEqual(clientCalls[0][1], ['mperez', 'hashed-value', 'estudiante', null, null, null, null]);
  assert.equal(user.id, 'uuid-2');
});

test('updatePassword replaces the hash for the given user id', async () => {
  let queries = 0;
  const repo = new PgUserRepository(
    createFakePool(async (text, params) => {
      queries += 1;
      assert.match(text, /UPDATE users SET password_hash = \$\d+ WHERE id = \$\d+/);
      assert.deepEqual(params, ['uuid-2', 'new-hashed-value']);
      return { rows: [] };
    }),
  );

  await repo.updatePassword('uuid-2', 'new-hashed-value');
  assert.equal(queries, 1);
});

test('toJSON never exposes the password hash or any audit column (UAC-001)', () => {
  const user = new User({
    id: 'uuid-3',
    username: 'jperez',
    passwordHash: 'secret-hash',
    role: 'estudiante',
    email: 'jperez@example.com',
    createdAt: CREATED_AT,
    createdBy: 'actor-1',
    updatedBy: 'actor-2',
    updatedAt: new Date('2026-08-06T12:00:00Z'),
  });
  const json = user.toJSON();
  assert.equal(json.passwordHash, undefined);
  assert.equal(json.username, 'jperez');
  assert.equal(json.email, 'jperez@example.com');
  assert.equal(JSON.stringify(user).includes('secret-hash'), false);
  // Audit columns are internal: none of the snake_case or camelCase keys leak.
  assert.deepEqual(Object.keys(json).sort(), ['createdAt', 'email', 'id', 'role', 'username']);
  assert.equal('created_by' in json, false);
  assert.equal('updated_by' in json, false);
  assert.equal('updated_at' in json, false);
});
