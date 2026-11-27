import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// DB-free structural check: derives the canonical inventory from migration files and verifies that
// every hard-coded integration count and positional ledger name agrees with it. It never imports
// integration modules, opens a socket, or reads any .env file.
const migrations = readdirSync('src/db/migrations').filter(name => /^\d+_.*\.sql$/.test(name)).sort();
const contractSource = readFileSync('tests/unit/patient-availability-integration-contract.test.js', 'utf8');
const seedDeclaration = contractSource.match(/const permissionSeeds = ([\s\S]*?);/);
assert.ok(seedDeclaration, 'shared canonical permission seed inventory is required');
const permissionSeeds = vm.runInNewContext(seedDeclaration[1], Object.create(null), { timeout: 1000 });
const permissions = new Set();
const grants = new Set();
for (const seed of permissionSeeds) {
  assert.ok(migrations.includes(seed), `${seed} must be a migration file`);
  const sql = readFileSync(`src/db/migrations/${seed}`, 'utf8');
  for (const [, permission] of sql.matchAll(/\('([^']+:[^']+)',\s*(?:true|false)\)/g)) permissions.add(permission);
  for (const [, role, permission] of sql.matchAll(/\('(admin|teacher|estudiante|reception)',\s*'([^']+)'\)/g)) grants.add(`${role}:${permission}`);
}
for (const grant of [...grants].filter(value => value.endsWith(':reception:availability:manage'))) {
  grants.add(grant.replace(':reception:availability:manage', ':reception:availability:read'));
}

const lineAt = (source, index) => source.slice(0, index).split('\n').length;

const auditIntegrationSource = (file, source) => {
  const mismatches = [];
  const report = (index, kind, detail) => mismatches.push(`${file}:${lineAt(source, index)} ${kind}: ${detail}`);
  const countRules = [
    ['standalone permission count', /\bpermissions\.length,\s*(\d+)/g, permissions.size],
    ['standalone grant count', /\bgrants\.length,\s*(\d+)/g, grants.size],
    ['baseline permissions literal', /\bpermissions:\s*(\d+)/g, permissions.size],
    ['baseline grants literal', /\bgrants:\s*(\d+)/g, grants.size],
    ['permission message count', /(\d+)-permission\b/g, permissions.size],
    ['grant message count', /(\d+)-grant\b/g, grants.size],
  ];
  for (const [kind, pattern, expected] of countRules) {
    for (const match of source.matchAll(pattern)) {
      if (Number(match[1]) !== expected) report(match.index, kind, `found ${match[1]}, canonical ${expected}`);
    }
  }
  for (const match of source.matchAll(/assert\.equal\((ledger\.rowCount|rows\.length),\s*(\d+)\s*(?:,\s*'([^']*)')?\)/g)) {
    const isLedgerTotal = match[1] === 'ledger.rowCount' || /\bmigrations\b/.test(match[3] ?? '');
    if (isLedgerTotal && Number(match[2]) !== migrations.length) {
      report(match.index, 'migration ledger total', `found ${match[2]}, canonical ${migrations.length}`);
    }
  }
  for (const match of source.matchAll(/\bledger\.rows\.at\(-(\d+)\)\.name\s*,\s*'([^']+)'/g)) {
    const expected = migrations.at(-Number(match[1]));
    if (match[2] !== expected) {
      report(match.index, `positional ledger name at(-${match[1]})`, `found ${match[2]}, canonical ${expected}`);
    }
  }
  return mismatches;
};

test('canonical inventory is derived from migration files, not hard-coded', () => {
  assert.ok(migrations.length > 0);
  assert.ok(permissions.size > 0);
  assert.ok(grants.size > 0);
  assert.ok(permissionSeeds.every(seed => migrations.includes(seed)));
});

test('every tests/integration suite agrees with the canonical permission, grant, and ledger inventory', () => {
  const files = readdirSync('tests/integration').filter(name => /\.test\.js$/.test(name)).sort();
  const mismatches = files.flatMap(file => auditIntegrationSource(`tests/integration/${file}`, readFileSync(`tests/integration/${file}`, 'utf8')));
  assert.deepEqual(mismatches, []);
});

test('the audit flags stale standalone counts and offset ledger names, and accepts canonical ones', () => {
  const stale = [
    "assert.equal(permissions.length, 57, 'exact 57-permission canonical baseline required');",
    'assert.equal(grants.length, 74);',
    "assert.equal(rows.length, 64, 'all migrations through 064 must be present');",
    "assert.equal(ledger.rows.at(-3).name, '061_add_patient_personal_data.sql');",
  ].join('\n');
  assert.equal(auditIntegrationSource('synthetic.test.js', stale).length, 5);
  const canonical = [
    `assert.equal(permissions.length, ${permissions.size}, 'exact ${permissions.size}-permission canonical baseline required');`,
    `assert.equal(grants.length, ${grants.size});`,
    `assert.equal(rows.length, ${migrations.length}, 'all migrations must be present');`,
    `assert.equal(ledger.rows.at(-1).name, '${migrations.at(-1)}');`,
    "assert.equal(rows.length, 1);",
  ].join('\n');
  assert.deepEqual(auditIntegrationSource('synthetic.test.js', canonical), []);
});
