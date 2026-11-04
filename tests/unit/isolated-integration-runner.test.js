import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const runner = path.join(root, 'tests/helpers/run-isolated-integration.mjs');
const manifestDirectory = path.join(root, '.git/gentle-scratch/disposable-integration');
const cleanEnv = () => Object.fromEntries(['PATH','SystemRoot','ComSpec','TEMP','TMP','TMPDIR']
  .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const names = () => existsSync(manifestDirectory) ? readdirSync(manifestDirectory).sort() : null;

test('public runner rejects missing opt-in before connecting or changing manifest state', () => {
  const before = names();
  const result = spawnSync(process.execPath, [runner, '--disposable'], { cwd:root, encoding:'utf8', env:cleanEnv() });
  assert.equal(result.status, 2); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'RUN_REFUSED explicit disposable-target opt-in required\n');
  assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\/|secret/i);
  assert.deepEqual(names(), before);
});

test('runner help documents the explicit disposable route', () => {
  const result = spawnSync(process.execPath, [runner, '--help'], { cwd:root, encoding:'utf8', env:cleanEnv() });
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.match(result.stdout, /--disposable/); assert.match(result.stdout, /salud_e2e_<16 hex>/);
  assert.match(result.stdout, /every sorted tests\/integration\/\*\*\/\*\.test\.js/);
  assert.match(result.stdout, /history-dependent fixtures/);
});

test('runner refuses injected URLs, manifest paths, and PG overrides before manifest changes', () => {
  const before = names();
  const cases = [
    { DISPOSABLE_INTEGRATION_TARGET:'true', DATABASE_URL:'postgresql://x:y@127.0.0.1:5432/saludback_test' },
    { DISPOSABLE_INTEGRATION_TARGET:'true', DISPOSABLE_INTEGRATION_MANIFEST:path.join(root,'injected.json') },
    { DISPOSABLE_INTEGRATION_TARGET:'true', PGHOST:'example.invalid' },
  ];
  for (const extra of cases) {
    const result = spawnSync(process.execPath, [runner,'--disposable'], { cwd:root, encoding:'utf8', env:{...cleanEnv(),...extra} });
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'RUN_REFUSED ambient database or application credentials are forbidden; use a clean shell\n');
    assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\/|secret/i);
  }
  assert.deepEqual(names(), before);
});

test('readIdentity accepts numeric OIDs and rejects invalid OID or peer/socket identity', async () => {
  const { readIdentity } = await import('../helpers/run-isolated-integration.mjs');
  const name = 'salud_e2e_0123456789abcdef';
  const identity = { databaseName:name, databaseUser:'integration_owner', databaseOid:'16384', databaseOwner:'integration_owner',
    serverAddress:'127.0.0.1', serverPort:5432, peer:'127.0.0.1', public_oid:'2200', server_version:'16' };
  const clientFor = (changes = {}, socketChanges = {}) => ({
    connection:{stream:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.1',remotePort:5432,...socketChanges}},
    query:async (sql) => { assert.match(sql,/inet_client_addr\(\)::text AS peer/); return {rows:[{...identity,...changes}]}; },
  });
  assert.deepEqual(await readIdentity(clientFor(),name),identity);
  await assert.rejects(readIdentity(clientFor({databaseOid:'16x'}),name),/new database live identity mismatch/);
  await assert.rejects(readIdentity(clientFor({peer:'127.0.0.2'}),name),/new database live identity mismatch/);
  await assert.rejects(readIdentity(clientFor({}, {remoteAddress:'192.0.2.1'}),name),/new database live identity mismatch/);
});

test('runner environment supplies the complete groups fixture contract and shared fingerprint', async () => {
  const { makeEnvironment, sanitizedOutput } = await import('../helpers/run-isolated-integration.mjs');
  const databaseUrl = 'postgresql://synthetic:secret@127.0.0.1:5432/salud_e2e_0123456789abcdef';
  const fingerprint = 'f'.repeat(64);
  const env = makeEnvironment(databaseUrl, fingerprint);
  for (const [key, value] of Object.entries({
    GROUPS_TEST_ISOLATED:'true', GROUPS_TEST_DATABASE_URL:databaseUrl,
    GROUPS_TEST_EXPECTED_DATABASE:'salud_e2e_0123456789abcdef', GROUPS_TEST_EXPECTED_SCHEMA:'public',
    GROUPS_TEST_EXPECTED_TARGET_FINGERPRINT:fingerprint, GROUPS_TEST_JWT_SECRET:env.JWT_SECRET,
    GROUPS_TEST_CLIENT_URL:env.CLIENT_URL, GROUPS_TEST_JWT_SECRET_KID:'current',
    GROUPS_TEST_JWT_EXPIRES_IN:'2h', GROUPS_TEST_BCRYPT_COST:'4',
    GROUPS_TEST_RESET_TOKEN_TTL:'15', GROUPS_TEST_RESET_TOKEN_MAX_OUTSTANDING:'3',
  })) assert.equal(env[key], value, key);
  assert.doesNotMatch(sanitizedOutput(JSON.stringify(env),env), /integration_owner|synthetic:secret/);
  assert.match(sanitizedOutput(env.JWT_SECRET,env), /^\[redacted-secret\]$/);
});

test('patient availability disposable adapter verifies before opening its read-only pool', () => {
  const source = readFileSync(path.join(root,'tests/integration/patient-availabilities.test.js'),'utf8');
  assert.match(source,/PATIENT_AVAILABILITY_DISPOSABLE_DATABASE_URL/);
  assert.match(source,/verifyDisposableIntegrationTarget/);
  assert.ok(source.indexOf('await verifyDisposableIntegrationTarget') < source.indexOf('new pg.Pool'));
  assert.match(source,/default_transaction_read_only=on/);
  assert.match(source,/no concurrency assertions/i);
});

test('creator metadata from a mismatched peer refuses before any CREATE callback', async () => {
  const { verifyCreatorSocket } = await import('../helpers/run-isolated-integration.mjs');
  let creates = 0;
  const client = { connection:{stream:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.2',remotePort:5432}}, query:async sql => {
    if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows:[] };
    return { rows:[{db:'postgres',usr:'owner',server:'127.0.0.1',port:5432,peer:'127.0.0.1',readonly:'on',can_create:true}] };
  }};
  await assert.rejects((async () => {
    await verifyCreatorSocket(client,[{address:'127.0.0.1'}],{user:'owner'});
    creates++;
  })(),/fresh creator socket identity/);
  assert.equal(creates,0);
});

test('CREATE acknowledgement/catalog failure and cleanup refusal preserve only verified droppable identity', async () => {
  const { mayDropRun, cleanupIdentity } = await import('../helpers/run-isolated-integration.mjs');
  const attempt = {name:'salud_e2e_0123456789abcdef',oid:null,owner:'owner',serverAddress:'127.0.0.1',serverPort:5432,
    manifestPath:'.git/gentle-scratch/disposable-integration/manifest-0123456789abcdef.json',creationAcknowledged:false};
  assert.equal(mayDropRun(attempt),false);
  const acknowledged = {...attempt,creationAcknowledged:true};
  assert.equal(mayDropRun(acknowledged),false); // catalog failed: never infer an OID or drop
  assert.match(cleanupIdentity(acknowledged),/oid=unavailable owner=owner server=127\.0\.0\.1:5432/);
  const owned = {...acknowledged,oid:'16384'};
  assert.equal(mayDropRun(owned),true);
  assert.match(cleanupIdentity(owned),/oid=16384 owner=owner/);
  const source = readFileSync(runner,'utf8');
  const create = source.indexOf('await creator.query(`CREATE DATABASE');
  const attemptRecord = source.indexOf("state:'creation-attempted'");
  assert.ok(attemptRecord >= 0 && attemptRecord < create);
  assert.match(source,/databaseOid:'unavailable'/);
  assert.match(source,/run\.creationAcknowledged=true; manifest\.state='create-acknowledged'/);
  assert.match(source,/if\(run&&manifestHandle&&mayDropRun\(run\)\)/);
  assert.match(source,/CLEANUP_REQUIRED .*; \$\{cleanupIdentity\(run\)\}/);
  assert.doesNotMatch(source,/console\.error\([^\n]*error\.stack/);
});

test('readIdentity selects and verifies the connected client peer and socket', () => {
  const source = readFileSync(runner, 'utf8');
  const identity = source.slice(source.indexOf('async function readIdentity'), source.indexOf('function baselineEmptySchema'));
  assert.match(identity, /inet_client_addr\(\)::text AS peer/);
  assert.match(identity, /if\s*\(rows\.length\s*!==\s*1\)/);
  assert.match(identity, /loopback\(id\.peer\)/);
  assert.match(identity, /norm\(id\.peer\)\s*!==\s*norm\(socket\.localAddress\)/);
  assert.match(identity, /norm\(id\.serverAddress\)\s*!==\s*norm\(socket\.remoteAddress\)/);
});

test('manifest binding remains in outer run scope through migration and fingerprint update', () => {
  const source = readFileSync(runner, 'utf8');
  const main = source.slice(source.indexOf('async function main'), source.indexOf('\ntry { await main();'));
  assert.match(main, /let source, resolved, run, manifestHandle, result=1, manifest;/);
  assert.match(main, /manifest\s*=\s*\{format:1/);
  assert.match(main, /manifest\.database\.schemaFingerprint\s*=\s*schemaFingerprint/);
  assert.match(main, /run\.manifest\s*=\s*manifest/);
  assert.doesNotMatch(main, /const pathName=file,\s*manifest=/);
});

test('read-only post-migration target connection closes before suite execution', () => {
  const source = readFileSync(runner, 'utf8');
  const finalTarget = source.slice(source.indexOf('const finalTarget'), source.indexOf('const suiteResult=spawnSync'));
  assert.match(finalTarget, /await finalTarget\.query\('ROLLBACK'\)/);
  assert.match(finalTarget, /finally\s*\{\s*await finalTarget\.end\(\);\s*\}/);
});

test('post-migration target preflight requires exactly the A3 ledger count', () => {
  const source = readFileSync(runner, 'utf8');
  assert.match(source, /ledger\.rowCount!==34/);
  assert.doesNotMatch(source, /ledger\.rowCount!==32/);
});

test('runner treats any skipped integration test as failure', () => {
  const source = readFileSync(runner, 'utf8');
  assert.match(source, /function hasSkippedTests\(output\)/);
  assert.match(source, /--test-reporter=tap/);
  assert.match(source, /result=suiteResult\.error\|\|suiteResult\.status!==0\|\|skipped\?1:0/);
});

test('runner discovers every sorted integration test and rejects an empty discovery', () => {
  const source = readFileSync(runner, 'utf8');
  assert.match(source, /function discoverIntegrationSuites/);
  const discovery = source.slice(source.indexOf('function discoverIntegrationSuites'), source.indexOf('const usage'));
  assert.match(discovery, /fs\.readdirSync/);
  assert.match(discovery, /path\.join\(ROOT,\s*['\"]tests['\"],\s*['\"]integration['\"]\)/);
  assert.match(discovery, /\.test\.js/);
  assert.match(discovery, /\.sort\(/);
  assert.match(discovery, /suites\.length\s*===\s*0/);
  assert.doesNotMatch(source, /const SUITES\s*=\s*\[/);
});
