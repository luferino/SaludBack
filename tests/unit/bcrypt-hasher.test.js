import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BcryptHasher } from '../../src/modules/auth/infrastructure/services/bcrypt-hasher.service.ts';

const hasher = new BcryptHasher(4); // low cost keeps tests fast

test('hash returns a bcrypt hash that differs from the plaintext', async () => {
  const hash = await hasher.hash('secret123');
  assert.notEqual(hash, 'secret123');
  assert.match(hash, /^\$2[aby]\$/);
});

test('compare succeeds for the correct password', async () => {
  const hash = await hasher.hash('secret123');
  assert.equal(await hasher.compare('secret123', hash), true);
});

test('compare fails for a wrong password', async () => {
  const hash = await hasher.hash('secret123');
  assert.equal(await hasher.compare('wrong-pass', hash), false);
});

test('same plaintext produces different hashes (per-password salt)', async () => {
  const [first, second] = await Promise.all([hasher.hash('secret123'), hasher.hash('secret123')]);
  assert.notEqual(first, second);
});

test('cost factor is honored', async () => {
  const hash = await new BcryptHasher(4).hash('secret123');
  assert.equal(hash.startsWith('$2b$04$') || hash.startsWith('$2a$04$'), true);
});
