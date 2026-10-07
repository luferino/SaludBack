import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const seed = readFileSync(new URL('../../src/db/migrations/011_seed_subject_permissions.sql', import.meta.url), 'utf8');

test('011 enforces only the independently delegated subject permissions and initially grants admin only', () => {
  assert.match(seed, /\('subjects:write', true\)/);
  assert.match(seed, /\('subjects:read', true\)/);
  assert.match(seed, /\('admin', 'subjects:write'\)/);
  assert.match(seed, /\('admin', 'subjects:read'\)/);
  assert.doesNotMatch(seed, /materias:read/);
  assert.doesNotMatch(seed, /\('(?!admin')[^']+', 'subjects:(?:read|write)'\)/);
  assert.equal((seed.match(/subjects:(?:read|write)/g) ?? []).length, 4);
});
