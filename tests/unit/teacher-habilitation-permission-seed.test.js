import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../src/db/migrations/014_seed_teacher_habilitation_permissions.sql', import.meta.url), 'utf8');

test('014 seeds one enforced delegable activation permission and initially grants it only to admin', () => {
  assert.match(migration, /\('teacher-habilitations:write',\s*true\)/);
  assert.match(migration, /\('admin',\s*'teacher-habilitations:write'\)/);
  assert.doesNotMatch(migration, /role\s+restriction|admin\s+bypass|clinical/i);
  assert.equal((migration.match(/teacher-habilitations:write/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /INSERT INTO permissions[\s\S]*teacher-habilitations:(?:read|clinical)/);
});
