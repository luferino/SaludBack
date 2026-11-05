import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function run(args) {
  return spawnSync(process.execPath, ['tests/helpers/run-isolated-integration.mjs', ...args], {
    env: Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
    encoding: 'utf8', timeout: 10000,
  });
}

test('career upgrade route requires explicit disposable opt-in before any database access', () => {
  const result = run(['--disposable', '--career-upgrade-rehearsal']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'RUN_REFUSED explicit disposable-target opt-in required\n');
});

test('ordinary disposable route retains its opt-in rejection and unknown options are rejected', () => {
  for (const [args, message] of [
    [['--disposable'], 'explicit disposable-target opt-in required'],
    [['--career-upgrade-rehearsal'], 'use the explicit --disposable option (or --help)'],
    [['--disposable', '--unknown'], 'use the explicit --disposable option (or --help)'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `RUN_REFUSED ${message}\n`);
  }
});

test('successful rehearsal cleanup outcome controls exit code and refusal never drops the database', async () => {
  const { finishRun } = await import('../helpers/run-isolated-integration.mjs');
  for (const [refuse, expectedCode] of [[false, 0], [true, 1]]) {
    const output = ['CAREER_UPGRADE_OK {"checks":"synthetic"}'];
    let drops = 0;
    const status = { exitCode: 0 };
    await finishRun({
      run: { name:'salud_e2e_0123456789abcdef', oid:'16384', owner:'owner', serverAddress:'127.0.0.1', serverPort:5432,
        manifestPath:'.git/gentle-scratch/disposable-integration/manifest-0123456789abcdef.json', creationAcknowledged:true },
      manifestHandle: 1, result: 0, status, source: 'postgres://localhost/postgres', resolved: [],
      cleanup: async () => { if (refuse) throw Object.assign(new Error('identity changed'), { safe:true }); drops++; output.push('CLEANUP_OK'); },
      log: (line) => output.push(line),
    });
    assert.equal(status.exitCode, expectedCode);
    if (refuse) {
      assert.match(output.join('\\n'), /CAREER_UPGRADE_OK .*CLEANUP_REQUIRED identity changed/);
      assert.equal(drops, 0);
    } else {
      assert.deepEqual(output, ['CAREER_UPGRADE_OK {"checks":"synthetic"}', 'CLEANUP_OK']);
      assert.equal(drops, 1);
    }
  }
});

test('runner help documents the bounded upgrade rehearsal separately from the full suite', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /--disposable --career-upgrade-rehearsal/);
  assert.match(result.stdout, /001–035.*036\/037/);
});
