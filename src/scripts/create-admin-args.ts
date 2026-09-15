/**
 * Strict flag parser for the create-admin CLI. Pure module: no config, no DB,
 * no process access beyond the argv input. Supports both `--flag value` and
 * `--flag=value` forms for `--username` / `--password`, throws on any unknown
 * option or missing value, and surfaces `--help` / `-h` as a marker so the
 * caller can print usage and exit 0.
 */

export interface CreateAdminFlags {
  username?: string;
  password?: string;
}

export type CreateAdminArgs = { help: true } | CreateAdminFlags;

const HELP_FLAGS = new Set(['--help', '-h']);
const OPTIONS = new Set(['--username', '--password']);

export function parseArgs(argv: string[]): CreateAdminArgs {
  // Help wins even when other flags are present, so `--help` always prints
  // usage instead of failing on whatever else was typed.
  if (argv.some((arg) => HELP_FLAGS.has(arg))) {
    return { help: true };
  }

  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`unknown option: ${token}`);
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex !== -1) {
      const flag = token.slice(0, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      if (!OPTIONS.has(flag)) {
        throw new Error(`unknown option: ${flag}`);
      }
      if (value === '') {
        throw new Error(`missing value for option: ${flag}`);
      }
      result[flag.slice(2)] = value;
      continue;
    }

    if (!OPTIONS.has(token)) {
      throw new Error(`unknown option: ${token}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`missing value for option: ${token}`);
    }
    result[token.slice(2)] = value;
    i += 1;
  }
  return result;
}