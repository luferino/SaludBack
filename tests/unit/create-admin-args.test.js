import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../src/scripts/create-admin-args.ts';

const successCases = [
  {
    name: 'parses both flags in spaced form',
    argv: ['--username', 'ROOT', '--password', 'X'],
    expected: { username: 'ROOT', password: 'X' },
  },
  {
    name: 'parses both flags in equals form',
    argv: ['--username=ROOT', '--password=X'],
    expected: { username: 'ROOT', password: 'X' },
  },
  {
    name: 'parses mixed spaced and equals forms',
    argv: ['--username=ROOT', '--password', 'X'],
    expected: { username: 'ROOT', password: 'X' },
  },
  {
    name: 'parses a single flag',
    argv: ['--password', 'secret'],
    expected: { password: 'secret' },
  },
  {
    name: 'returns an empty object for empty argv',
    argv: [],
    expected: {},
  },
  {
    name: 'repeated spaced flag: last one wins',
    argv: ['--username', 'A', '--username', 'B'],
    expected: { username: 'B' },
  },
  {
    name: 'repeated equals-form flag: last one wins',
    argv: ['--username=A', '--username=B'],
    expected: { username: 'B' },
  },
];

for (const { name, argv, expected } of successCases) {
  test(`parseArgs: ${name}`, () => {
    assert.deepEqual(parseArgs(argv), expected);
  });
}

const helpCases = [
  { name: '--help returns the help marker', argv: ['--help'] },
  { name: '-h returns the help marker', argv: ['-h'] },
  {
    name: 'help marker takes precedence over other flags',
    argv: ['--username', 'ROOT', '--help'],
  },
];

for (const { name, argv } of helpCases) {
  test(`parseArgs: ${name}`, () => {
    assert.deepEqual(parseArgs(argv), { help: true });
  });
}

const errorCases = [
  {
    name: 'rejects an unknown flag',
    argv: ['--usernme', 'ROOT'],
    message: 'unknown option: --usernme',
  },
  {
    name: 'rejects an unknown flag in equals form',
    argv: ['--usernme=ROOT'],
    message: 'unknown option: --usernme',
  },
  {
    name: 'rejects a flag with no value at the end of argv',
    argv: ['--username'],
    message: 'missing value for option: --username',
  },
  {
    name: 'rejects a flag followed by another flag (flag-like value)',
    argv: ['--username', '--password'],
    message: 'missing value for option: --username',
  },
  {
    name: 'rejects a flag followed by another flag ahead of a real value',
    argv: ['--password', '--username', 'ROOT'],
    message: 'missing value for option: --password',
  },
  {
    name: 'rejects an empty equals-form value',
    argv: ['--username='],
    message: 'missing value for option: --username',
  },
  {
    name: 'rejects an empty spaced-form value',
    argv: ['--username', ''],
    message: 'missing value for option: --username',
  },
  {
    name: 'rejects a bare positional value',
    argv: ['ROOT'],
    message: 'unknown option: ROOT',
  },
];

for (const { name, argv, message } of errorCases) {
  test(`parseArgs: ${name}`, () => {
    assert.throws(
      () => parseArgs(argv),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, message);
        return true;
      },
    );
  });
}