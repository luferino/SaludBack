import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const seed = readFileSync(new URL('../../src/db/migrations/013_seed_subject_group_permissions.sql', import.meta.url), 'utf8');

test('013 enforces independent association permissions and initially grants admin only', () => {
  assert.match(seed, /\('subject-groups:write', true\)/);
  assert.match(seed, /\('subject-groups:read', true\)/);
  assert.match(seed, /\('admin', 'subject-groups:write'\)/);
  assert.match(seed, /\('admin', 'subject-groups:read'\)/);
  assert.doesNotMatch(seed, /\('(?!admin')[^']+', 'subject-groups:(?:read|write)'\)/);
  assert.equal((seed.match(/subject-groups:(?:read|write)/g) ?? []).length, 4);
});
