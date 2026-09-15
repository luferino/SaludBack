import process from 'node:process';
import pg from 'pg';
import config from '../config.js';
import { parseArgs } from './create-admin-args.js';
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
const USAGE_LINES = [
  'Usage: tsx src/scripts/create-admin.ts --username <USERNAME> --password <PASSWORD>',
  '(or set ADMIN_USERNAME / ADMIN_PASSWORD). Dev-only bootstrap.',
];

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`create-admin: ${message}`);
    for (const line of USAGE_LINES) {
      console.error(line);
    }
    process.exitCode = 1;
    return;
  }

  if ('help' in args) {
    for (const line of USAGE_LINES) {
      console.log(line);
    }
    return;
  }

  const username = args.username ?? process.env.ADMIN_USERNAME;
  const password = args.password ?? process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    for (const line of USAGE_LINES) {
      console.error(line);
    }
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

await main();