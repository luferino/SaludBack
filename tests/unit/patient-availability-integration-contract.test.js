import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

// Source-only checks: do not import integration modules (their hooks can access a DB).
const migrations = readdirSync('src/db/migrations').filter(name => /^\d+_.*\.sql$/.test(name)).sort();
const suites = ['groups', 'subject-groups', 'student-habilitations', 'patient-assignments',
  'patient-assignment-lifecycle', 'student-habilitation-revocation', 'kinesiology-evaluation-drafts'];
for (const suite of suites) {
  test(`${suite} retains an explicit current migration preflight`, () => {
    const source = readFileSync(`tests/integration/${suite}.test.js`, 'utf8');
    const declaration = source.match(/const (?:EXPECTED_)?MIGRATIONS\s*=([\s\S]*?);/);
    assert.ok(declaration, 'explicit inventory is required before destructive cleanup');
    const declared = Array.from(vm.runInNewContext(declaration[1], Object.create(null), { timeout: 1000 }));
    assert.deepEqual(declared, migrations);
  });
}

const permissionSeeds = ['007_seed_permission_matrix.sql', '011_seed_subject_permissions.sql',
  '012_seed_group_permissions.sql', '013_seed_subject_group_permissions.sql',
  '014_seed_teacher_habilitation_permissions.sql', '015_seed_teacher_habilitation_revocation_permission.sql',
  '016_seed_student_habilitation_permissions.sql', '018_seed_patient_assignment_permissions.sql',
  '019_seed_student_habilitation_revocation_permission.sql', '021_seed_kinesiology_evaluation_permissions.sql',
  '027_seed_profile_read_permissions.sql', '028_seed_habilitation_read_permissions.sql',
  '030_seed_patient_availability_permissions.sql', '032_seed_kinesiology_evolution_permissions.sql'];
const permissions = new Set(), grants = new Set();
for (const seed of permissionSeeds) {
  const sql = readFileSync(`src/db/migrations/${seed}`, 'utf8');
  for (const match of sql.matchAll(/\('([^']+:[^']+)',\s*(?:true|false)\)/g)) permissions.add(match[1]);
  for (const match of sql.matchAll(/\('(admin|teacher|estudiante)',\s*'([^']+)'\)/g)) grants.add(`${match[1]}:${match[2]}`);
}
for (const suite of ['groups', 'subjects', 'subject-groups', 'kinesiology-evaluation-drafts']) {
  test(`${suite} preserves the exact canonical permission/grant preflight`, () => {
    const source = readFileSync(`tests/integration/${suite}.test.js`, 'utf8');
    for (const [name, expected] of [['EXPECTED_PERMISSIONS', permissions], ['EXPECTED_GRANTS', grants]]) {
      const declaration = source.match(new RegExp(`const ${name} =([\\s\\S]*?);`));
      assert.ok(declaration, name);
      const declared = vm.runInNewContext(declaration[1], Object.create(null), { timeout: 1000 });
      assert.deepEqual([...declared].sort(), [...expected].sort(), name);
    }
    assert.equal(permissions.size, 33);
    assert.equal(grants.size, 43);
  });
}
