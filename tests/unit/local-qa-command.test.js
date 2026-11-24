import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../scripts/local-qa.mjs', import.meta.url));
const help = 'Usage: node scripts/local-qa.mjs --disposable [--smoke]\n' +
  'Starts a disposable Windows PostgreSQL 18 and a loopback API with synthetic Hygiene II drafts.\n' +
  '--smoke verifies the API and stops without issuing browser login credentials.\n';

for (const entry of [
  { name: 'help', args: ['--help'], code: 0, stdout: help, stderr: '' },
  { name: 'explicit disposable opt-in', args: [], code: 2, stdout: '', stderr: 'QA_REFUSED: use --help or --disposable [--smoke].\n' },
  { name: 'no external target option', args: ['--disposable', '--database-url', 'https://example.invalid'], code: 2, stdout: '', stderr: 'QA_REFUSED: use --help or --disposable [--smoke].\n' },
  { name: 'refuse ambient credentials', args: ['--disposable', '--smoke'], env: { PGHOST: 'example.invalid', DATABASE_URL: 'synthetic-canary' }, code: 2, stdout: '', stderr: 'QA_REFUSED: remove inherited database, authentication, and Node loader overrides.\n' },
]) {
  test(`local QA CLI: ${entry.name}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'salud-qa-cli-test-'));
    try {
      const os = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|SYSTEMROOT|COMSPEC|SYSTEMDRIVE|WINDIR)$/i.test(k)));
      const result = spawnSync(process.execPath, [cli, ...entry.args], {
        encoding: 'utf8', timeout: 10_000,
        env: { ...os, TEMP: root, TMP: root, TMPDIR: root, ...entry.env },
      });
      assert.ifError(result.error);
      assert.deepEqual({ code: result.status, stdout: result.stdout, stderr: result.stderr, contents: readdirSync(root) }, {
        code: entry.code, stdout: entry.stdout, stderr: entry.stderr, contents: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
