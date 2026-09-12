import process from 'node:process';
import pg from 'pg';
import config from '../config.js';
import { PgUserRepository } from '../modules/auth/infrastructure/repositories/pg-user.repository.js';
import { BcryptHasher } from '../modules/auth/infrastructure/services/bcrypt-hasher.service.js';
import { CreateAdmin } from '../modules/auth/application/create-admin.usecase.js';
import { AppError } from '../modules/shared/domain/errors.js';

/**
 * First-admin bootstrap script (dev-only). Waiting for admins works after
 * this: once POST /auth/register is admin-gated, no admin can be born
 * through the API — this CLI is the bootstrap path. Wires the repository
 * and hasher exactly like src/app.ts and delegates to CreateAdmin, which
 * enforces the shared password/username rules.
 *
 * Usage (the --password argument is a dev-only convenience and can be
 * replaced by the ADMIN_PASSWORD env var to avoid shell history):
 *   tsx src/scripts/create-admin.ts --username ROOT --password <PASSWORD>
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const username = args.username ?? process.env.ADMIN_USERNAME;
  const password = args.password ?? process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.error('Usage: tsx src/scripts/create-admin.ts --username <USERNAME> --password <PASSWORD>');
    console.error('(or set ADMIN_USERNAME / ADMIN_PASSWORD). Dev-only bootstrap.');
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  try {
    const useCase = new CreateAdmin({
      repository: new PgUserRepository(pool),
      hasher: new BcryptHasher(config.bcryptCost),
    });
    const admin = await useCase.execute({ username, password });
    console.log(`Admin created: username=${admin.username} role=${admin.role} id=${admin.id}`);
  } catch (error) {
    if (error instanceof AppError) {
      console.error(`create-admin failed: ${error.message}`);
    } else {
      console.error('create-admin failed:', error);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

/** Tiny `--flag value` parser; unknown flags and flag-like values are ignored. */
function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === '--username' || flag === '--password') && value && !value.startsWith('--')) {
      result[flag.slice(2)] = value;
      i += 1;
    }
  }
  return result;
}

await main();