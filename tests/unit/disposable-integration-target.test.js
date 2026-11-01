import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { validateDisposableTarget } from '../helpers/disposable-integration-target.js';

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
  emptyBaseline: { users: 0, patients: 0, subjects: 0, assignments: 0 },
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

test('rejects changed live identity, schema fingerprint, and nonempty baselines', () => {
  rejectsSafely(cloneTarget({ identity: { ...identity, databaseOid: '99999' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ identity: { ...identity, databaseOwner: 'other_owner' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ identity: { ...identity, serverAddress: '192.0.2.1' } }), /identity mismatch/);
  rejectsSafely(cloneTarget({ schemaFingerprint: 'b'.repeat(64) }), /schema fingerprint mismatch/);
  rejectsSafely(cloneTarget({ emptyBaseline: { users: 1, patients: 0 } }), /empty baseline required/);
});
