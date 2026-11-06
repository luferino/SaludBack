import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const migrationsDir = new URL('../../src/db/migrations/', import.meta.url);
const sql = readFileSync(new URL('037_seed_career_permissions.sql', migrationsDir), 'utf8');

test('037 enforces careers:read as an independent catalog permission', () => {
  assert.match(sql, /INSERT INTO permissions \(permission, enforced\) VALUES\s+\('careers:read', true\)\s+ON CONFLICT \(permission\) DO NOTHING;/);
  assert.equal((sql.match(/'careers:read'/g) ?? []).length, 2, 'one catalog row and one grant');
});

test('037 grants careers:read to exactly the roles that hold subjects:read anywhere in the migration chain', () => {
  const subjectsReaders = new Set();
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d+_.*\.sql$/.test(name))) {
    const body = readFileSync(new URL(file, migrationsDir), 'utf8');
    for (const match of body.matchAll(/\('([^']+)',\s*'subjects:read'\)/g)) subjectsReaders.add(match[1]);
  }
  const careerReaders = [...sql.matchAll(/\('([^']+)',\s*'careers:read'\)/g)].map((match) => match[1]);
  assert.deepEqual([...subjectsReaders].sort(), ['admin']);
  assert.deepEqual(careerReaders.sort(), [...subjectsReaders].sort());
  assert.match(sql, /ON CONFLICT \(role, permission\) DO NOTHING;/);
});

test('037 contains no write, revoke, delete, or update semantics', () => {
  assert.doesNotMatch(sql, /:(?:write|revoke)|DELETE|UPDATE\s+role_permissions|TRUNCATE/i);
});
