import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  fail(
    'Missing required environment variable DATABASE_URL.\n' +
      'Run migrations with: pnpm db:migrate (loads .env via --env-file).',
  );
}

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Applying ${file}...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  console.log(`Migrations finished. Applied ${appliedCount} new file(s).`);
} catch (error) {
  fail(`Migration failed: ${error.message}`);
} finally {
  await client.end();
}
