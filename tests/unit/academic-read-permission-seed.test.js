import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const seeds = [
  ['027_seed_profile_read_permissions.sql', ['teachers:read', 'students:read'], [
    ['admin', 'teachers:read'], ['admin', 'students:read'], ['teacher', 'students:read'],
  ]],
  ['028_seed_habilitation_read_permissions.sql', ['teacher-habilitations:read', 'student-habilitations:read'], [
    ['admin', 'teacher-habilitations:read'], ['admin', 'student-habilitations:read'], ['teacher', 'student-habilitations:read'],
  ]],
];

for (const [filename, permissions, grants] of seeds) {
  test(`${filename} seeds independent enforced reads with only the approved initial grants`, () => {
    const sql = readFileSync(new URL(`../../src/db/migrations/${filename}`, import.meta.url), 'utf8');
    const enforced = [...sql.matchAll(/\('([^']+:read)',\s*true\)/g)].map((match) => match[1]);
    const seededGrants = [...sql.matchAll(/\('([^']+)',\s*'([^']+:read)'\)/g)].map((match) => [match[1], match[2]]);
    assert.deepEqual(enforced.sort(), [...permissions].sort());
    assert.deepEqual(seededGrants.sort(), [...grants].sort());
    assert.doesNotMatch(sql, /:(?:write|revoke)|DELETE|UPDATE\s+role_permissions/i);
    assert.match(sql, /ON CONFLICT \(role, permission\) DO NOTHING/);
  });
}
