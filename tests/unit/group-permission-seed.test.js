import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const seed = readFileSync(new URL('../../src/db/migrations/012_seed_group_permissions.sql', import.meta.url), 'utf8');

test('012 enforces only the independently delegated group permissions and initially grants admin only', () => {
  assert.match(seed, /\('groups:write', true\)/);
  assert.match(seed, /\('groups:read', true\)/);
  assert.match(seed, /\('admin', 'groups:write'\)/);
  assert.match(seed, /\('admin', 'groups:read'\)/);
  assert.doesNotMatch(seed, /\('(?!admin')[^']+', 'groups:(?:read|write)'\)/);
  assert.equal((seed.match(/groups:(?:read|write)/g) ?? []).length, 4);
});
