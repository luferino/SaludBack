import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

test('rejects changed live identity, schema fingerprint, and nonempty baselines', () => {
  rejectsSafely(cloneTarget({ identity: { ...identity, databaseOid: '99999' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ identity: { ...identity, databaseOwner: 'other_owner' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ identity: { ...identity, serverAddress: '192.0.2.1' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ schemaFingerprint: 'b'.repeat(64) }), /schema fingerprint mismatch/);
  rejectsSafely(cloneTarget({ emptyBaseline: { users: 1, patients: 0 } }), /complete disposable database empty baseline required/);
  rejectsSafely(cloneTarget({ emptyBaseline: { irrelevant: 0 } }), /complete disposable database empty baseline required/);
});
