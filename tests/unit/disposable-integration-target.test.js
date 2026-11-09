import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { REQUIRED_EMPTY_BASELINE_TABLES, validateDisposableTarget, validateDisposableTargetEnvironment, verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const fingerprint = 'a'.repeat(64);
const databaseName = 'salud_e2e_0123456789abcdef';
const connectionString = `postgresql://integration_owner:secret@127.0.0.1:5432/${databaseName}`;
const identity = {
  databaseName,
  databaseOid: '16384',
  databaseOwner: 'integration_owner',
  databaseUser: 'integration_owner',
  serverAddress: '127.0.0.1',
  serverPort: 5432,
};
const cwd = process.cwd();
const manifestPath = path.resolve(cwd, '.git/gentle-scratch/disposable-integration/manifest-0123456789abcdef.json');
const validTarget = {
  env: {
    DISPOSABLE_INTEGRATION_TARGET: 'true',
    DISPOSABLE_INTEGRATION_DATABASE_URL: connectionString,
    DATABASE_URL: connectionString,
  },
  cwd,
  manifestPath,
  manifestRealPath: manifestPath,
  manifestPathHasSymlink: false,
  manifest: {
    format: 1,
    createdByRun: true,
    creationMode: 'exclusive',
    database: {
      ...identity,
      oid: identity.databaseOid,
      owner: identity.databaseOwner,
      name: identity.databaseName,
      createdByRun: true,
      schemaFingerprint: fingerprint,
    },
  },
  identity,
  schemaFingerprint: fingerprint,
  emptyBaseline: Object.fromEntries(REQUIRED_EMPTY_BASELINE_TABLES.map((table) => [table, 0])),
};
const cloneTarget = (changes = {}) => ({ ...validTarget, ...changes });
const rejectsSafely = (input, message) => {
  assert.throws(() => validateDisposableTarget(input), (error) => {
    assert.equal(error.code, 'DISPOSABLE_TARGET_INVALID');
    assert.match(error.message, message);
    assert.doesNotMatch(error.message, /secret|postgres(?:ql)?:\/\//i);
    return true;
  });
};

test('live guard rejects missing opt-in before reading a manifest or opening a socket', async () => {
  await assert.rejects(verifyDisposableIntegrationTarget({ env:{}, cwd }), /explicit disposable-target opt-in required/);
});

test('refuses the shared saludback_test database even with explicit opt-in and matching metadata', () => {
  const unsafeUrl = 'postgresql://integration_owner:secret@127.0.0.1:5432/saludback_test';
  const unsafe = cloneTarget({
    env: { ...validTarget.env, DATABASE_URL: unsafeUrl, DISPOSABLE_INTEGRATION_DATABASE_URL: unsafeUrl },
    manifest: { ...validTarget.manifest, database: { ...validTarget.manifest.database, name: 'saludback_test' } },
    identity: { ...identity, databaseName: 'saludback_test' },
  });
  rejectsSafely(unsafe, /generated disposable database name required/);
});

test('accepts a positively opted-in generated target only when manifest, identity, fingerprint, and baseline agree', () => {
  const result = validateDisposableTarget(validTarget);
  assert.equal(result.databaseName, databaseName);
  assert.equal(result.manifestPath, manifestPath);
  assert.equal(result.schemaFingerprint, fingerprint);
  assert.deepEqual(validateDisposableTargetEnvironment(validTarget.env), { databaseName });
  assert.deepEqual(result.identity, {
    databaseName,
    databaseOid: '16384',
    databaseOwner: 'integration_owner',
    serverAddress: '127.0.0.1',
    serverPort: 5432,
  });
  assert.equal(Object.hasOwn(result, 'connectionString'), false);
  assert.doesNotMatch(JSON.stringify(result), /secret|postgres(?:ql)?:\/\//i);
});

test('rejects absent opt-in, injected environment URL, and non-loopback targets', () => {
  rejectsSafely(cloneTarget({ env: { ...validTarget.env, DISPOSABLE_INTEGRATION_TARGET: 'false' } }), /explicit disposable-target opt-in required/);
  rejectsSafely(cloneTarget({ env: { ...validTarget.env, DATABASE_URL: 'postgresql://other:secret@127.0.0.1:5432/salud_e2e_0123456789abcdef' } }), /environment binding mismatch/);
  rejectsSafely(cloneTarget({ env: { ...validTarget.env, PGHOST: 'remote.example' } }), /inherited PostgreSQL connection overrides/);
  const remote = 'postgresql://integration_owner:secret@example.com:5432/salud_e2e_0123456789abcdef';
  rejectsSafely(cloneTarget({ env: { ...validTarget.env, DATABASE_URL: remote, DISPOSABLE_INTEGRATION_DATABASE_URL: remote } }), /loopback/);
});

test('rejects missing, noncanonical, symlinked, or non-exclusively-created manifests', () => {
  rejectsSafely(cloneTarget({ manifest: null }), /manifest mismatch/);
  rejectsSafely(cloneTarget({ cwd: undefined }), /canonical in-project/);
  rejectsSafely(cloneTarget({ manifestRealPath: `${manifestPath}.elsewhere` }), /canonical in-project/);
  rejectsSafely(cloneTarget({ manifestPathHasSymlink: true }), /canonical in-project/);
  rejectsSafely(cloneTarget({ manifest: { ...validTarget.manifest, creationMode: 'overwrite' } }), /manifest mismatch/);
});

test('requires every known application table in the empty baseline', () => {
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_amendment_links'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolutions'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_submissions'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_correction_requests'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_validation_reviews'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('kinesiology_evolution_amendment_links'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('reception_career_grants'));
  assert.ok(REQUIRED_EMPTY_BASELINE_TABLES.includes('reception_patient_enrollments'));
  rejectsSafely(cloneTarget({ emptyBaseline: { irrelevant: 0 } }), /complete disposable database empty baseline required/);
  const missing = { ...validTarget.emptyBaseline }; delete missing.patients;
  rejectsSafely(cloneTarget({ emptyBaseline: missing }), /complete disposable database empty baseline required/);
});

test('retains original guard defaults and subject-suite isolation fingerprints when opt-in is absent', () => {
  const lifecycle = readFileSync(path.join(cwd,'tests/integration/patient-assignment-lifecycle.test.js'),'utf8');
  const availability = readFileSync(path.join(cwd,'tests/integration/patient-availability-contract.test.js'),'utf8');
  const subjects = readFileSync(path.join(cwd,'tests/integration/subjects.test.js'),'utf8');
  const groups = readFileSync(path.join(cwd,'tests/integration/subject-groups.test.js'),'utf8');
  const groupsFixture = readFileSync(path.join(cwd,'tests/integration/groups.test.js'),'utf8');
  assert.match(lifecycle,/\.env\.test/); assert.match(lifecycle,/saludback_test/);
  assert.match(availability,/\.env\.test/); assert.match(availability,/saludback_test/);
  assert.match(subjects,/SUBJECTS_TEST_ISOLATED/); assert.match(subjects,/REQUIRED_SUBJECTS_TEST_ENV/);
  assert.match(groups,/const ENV_PREFIX = 'SUBJECT_GROUPS_TEST_'/);
  assert.match(groups,/const ISOLATION_FLAG = `\$\{ENV_PREFIX\}ISOLATED`/);
  assert.match(groups,/EXPECTED_TARGET_FINGERPRINT/);
  assert.ok(groupsFixture.indexOf('await verifyDisposableIntegrationTarget()') < groupsFixture.indexOf('new pg.Pool'));
  assert.match(groupsFixture,/EXPECTED_TARGET_FINGERPRINT/);
  assert.match(groupsFixture,/EXPECTED_GRANTS/);
});

test('remaining legacy suites opt into the shared live guard before pool cleanup and retain defaults', () => {
  const adapters = [
    ['patient-assignments.test.js', /process\.env\.DATABASE_URL === fileUrl/, 'const fileUrl = testUrl();'],
    ['kinesiology-evaluation-drafts.test.js', /process\.env\.DATABASE_URL === value/, 'const { value, url } = exactTestUrl();'],
    ['student-habilitations.test.js', /assert\.equal\(process\.env\.DATABASE_URL, fileUrl/, 'const fileUrl = databaseUrlFromFile();'],
    ['student-habilitation-revocation.test.js', /process\.env\.DATABASE_URL === value/, "const value = readFileSync('.env.test', 'utf8')"],
  ];
  for (const [file, defaultGuard, defaultPath] of adapters) {
    const source = readFileSync(path.join(cwd,'tests/integration',file),'utf8');
    const optIn = source.indexOf("if (process.env.DISPOSABLE_INTEGRATION_TARGET === 'true')");
    const verify = source.indexOf('await verifyDisposableIntegrationTarget();',optIn);
    assert.ok(optIn >= 0 && verify > optIn, `${file} must invoke the shared verifier on explicit opt-in`);
    assert.ok(source.indexOf(defaultPath,verify) > verify, `${file} must preserve its default .env.test path`);
    assert.ok(source.indexOf('new pg.Pool') > verify, `${file} must verify before opening its fixture pool`);
    assert.ok(source.indexOf('await cleanDb(pool)') > verify, `${file} must verify before fixture cleanup`);
    assert.match(source, defaultGuard, `${file} must retain its original DATABASE_URL equality check`);
  }
});

test('legacy integration preflights match the canonical permission/grant inventory, required table set, and ledger range', () => {
  const revocation = readFileSync(path.join(cwd,'tests/integration/student-habilitation-revocation.test.js'),'utf8');
  const habilitations = readFileSync(path.join(cwd,'tests/integration/student-habilitations.test.js'),'utf8');
  const assignments = readFileSync(path.join(cwd,'tests/integration/patient-assignments.test.js'),'utf8');
  const drafts = readFileSync(path.join(cwd,'tests/integration/kinesiology-evaluation-drafts.test.js'),'utf8');
  const inventorySource = readFileSync(path.join(cwd,'tests/unit/patient-availability-integration-contract.test.js'),'utf8');
  const seedDeclaration = inventorySource.match(/const permissionSeeds = ([\s\S]*?);/);
  assert.ok(seedDeclaration, 'shared canonical permission seed inventory is required');
  const permissionSeeds = vm.runInNewContext(seedDeclaration[1], Object.create(null), { timeout: 1000 });
  const permissions = new Set(), grants = new Set();
  for (const seed of permissionSeeds) {
    const sql = readFileSync(path.join(cwd,'src/db/migrations',seed),'utf8');
    for (const [, permission] of sql.matchAll(/\('([^']+:[^']+)',\s*(?:true|false)\)/g)) permissions.add(permission);
    for (const [, role, permission] of sql.matchAll(/\('(admin|teacher|estudiante|reception)',\s*'([^']+)'\)/g)) grants.add(`${role}:${permission}`);
  }
  const assertCanonicalCounts = (source, expectedPermissions, expectedGrants) => {
    const counts = source.match(/permissions\s*:\s*(\d+),\s*grants\s*:\s*(\d+)/);
    assert.ok(counts, 'integration source must declare its permission/grant baseline');
    assert.deepEqual({ permissions: Number(counts[1]), grants: Number(counts[2]) },
      { permissions: expectedPermissions, grants: expectedGrants });
  };
  assertCanonicalCounts(revocation, permissions.size, grants.size);
  const driftedPermissions = new Set(permissions).add('test:drift');
  const driftedGrants = new Set(grants).add('teacher:test:drift');
  assert.throws(() => assertCanonicalCounts(revocation, driftedPermissions.size, grants.size), assert.AssertionError);
  assert.throws(() => assertCanonicalCounts(revocation, permissions.size, driftedGrants.size), assert.AssertionError);

  assert.match(habilitations,/assert\.deepEqual\(new Set\(required\.map\(\(\{ tablename \}\) => tablename\)\), new Set\(REQUIRED_TABLES\)/);
  assert.doesNotMatch(habilitations,/required\.length,\s*24/);
  assert.match(assignments,/exact expected migration ledger 001-046 is required before fixture cleanup/);
  assert.match(drafts,/exact migration ledger 001–046 required before cleanup/);
});

test('rejects changed live identity, schema fingerprint, and nonempty baselines', () => {
  rejectsSafely(cloneTarget({ identity: { ...identity, databaseOid: '99999' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ identity: { ...identity, databaseOwner: 'other_owner' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ identity: { ...identity, serverAddress: '192.0.2.1' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ schemaFingerprint: 'b'.repeat(64) }), /schema fingerprint mismatch/);
  rejectsSafely(cloneTarget({ emptyBaseline: { users: 1, patients: 0 } }), /complete disposable database empty baseline required/);
  rejectsSafely(cloneTarget({ emptyBaseline: { irrelevant: 0 } }), /complete disposable database empty baseline required/);
});
