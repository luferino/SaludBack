import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run unchanged HTTP tests: do not emulate authentication, Express, or fetch.
const baseline = '50c56b6ea7d81b95df0e6ba41dff183b11860001';
const candidate = '0d92890bf7a34fe2279c66ba97e698efd20698ab';
const root = fileURLToPath(new URL('../../', import.meta.url));
const loader = new URL('../helpers/clinical-baseline-loader.js', import.meta.url).href;
const suites = [
  'kinesiology-evaluation-drafts',
  'patient-assignments',
  'patient-assignment-lifecycle',
];

function run(revision, suite) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, TSX_DISABLE_CACHE: '1', CLINICAL_DIFF_REVISION: revision };
    delete env.NODE_TEST_CONTEXT; // Nested test processes need their own reporter.
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', loader,
      '--test', '--test-reporter=tap', `tests/unit/${suite}.test.js`], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

for (const suite of suites) {
  test(`${suite}: original HTTP tests pass against both revisions with identical responses`, { timeout: 120000 }, async () => {
    assert.equal(execFileSync('git', ['diff', candidate, '--', 'src'], { cwd: root, encoding: 'utf8' }), '',
      'working production sources must match the fixed candidate');
    const changedSources = execFileSync('git', ['diff', '--name-only', baseline, candidate, '--', 'src'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    assert.ok(changedSources.every(path => /^src\/modules\/(kinesiology-evaluations|patient-assignments)\//.test(path)),
      'baseline dependencies outside the overlaid modules must be unchanged');
    assert.equal(execFileSync('git', ['diff', baseline, '--', `tests/unit/${suite}.test.js`], { cwd: root, encoding: 'utf8' }), '',
      'original assertions must be unchanged from baseline');
    const results = [];
    for (const revision of [baseline, candidate]) {
      const result = await run(revision, suite);
      assert.equal(result.code, 0, `${revision}: ${result.stdout.slice(0, 2500)}\n${result.stdout.slice(-1000)}\n${result.stderr.slice(-1000)}`);
      assert.match(result.stdout, /# fail 0\b/);
      assert.match(result.stdout, /# skipped 0\b/);
      const loaded = result.stdout.split('\n').filter(line => line.includes('CLINICAL_SOURCE '))
        .map(line => JSON.parse(Buffer.from(line.slice(line.indexOf('CLINICAL_SOURCE ') + 'CLINICAL_SOURCE '.length).trim(), 'base64').toString('utf8')));
      for (const module of ['kinesiology-evaluations', 'patient-assignments']) {
        assert.ok(loaded.some(entry => entry.revision === revision && entry.path === `src/modules/${module}/index.ts`),
          `must actually load ${module} from the selected Git revision`);
      }
      const cases = result.stdout.split('\n').filter(line => /^ok \d+ - /.test(line));
      const responses = result.stdout.split('\n').filter(line => line.includes('CLINICAL_HTTP '))
        .map(line => JSON.parse(Buffer.from(line.slice(line.indexOf('CLINICAL_HTTP ') + 'CLINICAL_HTTP '.length).trim(), 'base64').toString('utf8')));
      assert.ok(cases.length > 0, 'must execute existing assertions');
      assert.ok(responses.length > 0, 'must capture public HTTP responses');
      results.push({ cases, responses });
    }
    assert.deepEqual(results[1], results[0], 'test outcomes and HTTP responses must match');
    console.log(`${suite}: ${results[0].cases.length} cases and ${results[0].responses.length} responses per revision matched`);
  });
}
