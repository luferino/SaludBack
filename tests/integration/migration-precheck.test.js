/**
 * STU-006 / TEA-005 — migration 005 pre-check integration tests.
 *
 * The one-profile-per-account rule (UNIQUE students.user_id / teachers.user_id)
 * was never enforced at the schema level. Migration 005 closes the gap with a
 * guarded DO $$ pre-check that aborts BEFORE any DDL when existing rows share a
 * user_id, listing the affected user_id + profile ids, with NO auto-repair.
 *
 * Harness: these tests drive the REAL migrate runner (src/db/migrate.ts) as a
 * spawned child process, because the runner wraps each migration file in one
 * transaction — exactly the semantics under test (a raise rolls back the DDL
 * AND the schema_migrations insert). Simulating the pre-005 state is done by
 * dropping the constraints and deleting the 005 schema_migrations row, so the
 * runner re-applies the file against the seeded duplicates.
 *
 * Shared-DB contract: every test restores the fully-migrated state before it
 * ends (before/after re-run the runner, which skips already-applied files), so
 * this suite never leaves the shared test DB half-migrated for other files.
 *
 * Serial-only: this suite mutates the shared schema (drops constraints, deletes
 * a schema_migrations row); it REQUIRES serial execution
 * (--test-concurrency=1) and must not run interleaved with other files.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import config from '../../src/config.ts';
import { cleanDb } from './helpers/clean-db.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const REPO_ROOT = new URL('../../', import.meta.url);
const MIGRATION_005 = '005_user_id_unique_profiles.sql';

/** Runs the real migrate runner in a child process; resolves with its outcome. */
function runMigrate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    // Watchdog: if the spawned runner hangs (e.g. unreachable DB) the promise
    // would never settle and hang the whole suite. Kill the child and resolve
    // with code null so the caller's assertion fails loudly instead.
    const watchdog = setTimeout(() => {
      child.kill();
      resolve({ code: null, stdout, stderr });
    }, 30_000);
    child.on('error', (err) => {
      // Spawn failure (bad cwd, missing binary): reject rather than wait for a
      // close event that may never fire.
      clearTimeout(watchdog);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(watchdog);
      resolve({ code, stdout, stderr });
    });
  });
}

async function ensureMigrated() {
  const result = await runMigrate();
  assert.equal(result.code, 0, `migrate should succeed, got ${result.code}: ${result.stderr}`);
  return result;
}

/** Simulates the pre-005 state: no constraints, no 005 schema_migrations row. */
async function dropUserUniques() {
  await pool.query('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_user_id_unique');
  await pool.query('ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_user_id_unique');
  await pool.query('DELETE FROM schema_migrations WHERE name = $1', [MIGRATION_005]);
}

async function constraintExists(table, name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = $1 AND constraint_name = $2`,
    [table, name],
  );
  return rows.length === 1;
}

/** Inserts a plain account row and returns its id (FK target for profiles). */
async function insertUser() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [id, `miguser-${id.slice(0, 8)}`, 'not-a-real-hash', 'estudiante'],
  );
  return id;
}

before(async () => {
  await cleanDb(pool);
  await ensureMigrated();
});

// Restore order matters: cleanDb() FIRST so a failed abort test's leftover
// duplicate rows can never make ensureMigrated() re-run the 005 pre-check and
// RAISE (which would mask the original failure). The migrated state is then the
// last thing restored, so self-heal stays viable on the next run too.
after(async () => {
  try {
    await cleanDb(pool);
  } finally {
    try {
      await ensureMigrated();
    } finally {
      await pool.end();
    }
  }
});

test('clean data: migration 005 applies both UNIQUE constraints and re-runs idempotently (STU-006/TEA-005)', async () => {
  await dropUserUniques();
  assert.equal(await constraintExists('students', 'students_user_id_unique'), false);
  assert.equal(await constraintExists('teachers', 'teachers_user_id_unique'), false);

  const applied = await runMigrate();
  assert.equal(applied.code, 0, `expected migrate to succeed, got ${applied.code}: ${applied.stderr}`);
  assert.match(applied.stdout, /Applying 005_user_id_unique_profiles\.sql/);
  assert.match(applied.stdout, /Applied 1 new file\(s\)/);

  assert.equal(await constraintExists('students', 'students_user_id_unique'), true);
  assert.equal(await constraintExists('teachers', 'teachers_user_id_unique'), true);
  const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [MIGRATION_005]);
  assert.equal(rows.length, 1, 'runner records 005 in schema_migrations');

  // Idempotent re-run: the runner skips the already-applied file and exits 0.
  const rerun = await runMigrate();
  assert.equal(rerun.code, 0, `idempotent re-run should exit 0, got ${rerun.code}: ${rerun.stderr}`);
  assert.match(rerun.stdout, /Skipping 005_user_id_unique_profiles\.sql \(already applied\)/);
  assert.match(rerun.stdout, /Applied 0 new file\(s\)/);
});

test('duplicate students.user_id aborts the migration before any DDL, listing user_id and profile ids (STU-006)', async () => {
  const userId = await insertUser();
  const firstId = randomUUID();
  const secondId = randomUUID();
  await dropUserUniques();
  await pool.query(
    `INSERT INTO students (id, user_id, nombres, apellidos, codalumno)
     VALUES ($1, $2, $3, $4, $5), ($6, $2, $3, $4, $7)`,
    [firstId, userId, 'Ana', 'Lopez', 'DUPSTU1', secondId, 'DUPSTU2'],
  );

  const result = await runMigrate();
  assert.equal(result.code, 1, `expected migrate to abort, got exit ${result.code}: ${result.stderr}`);
  const listed = result.stderr.match(
    /students\.user_id duplicates: ([0-9a-f-]+) -> \{([^}]+)\}/,
  );
  assert.ok(listed, `stderr must list the duplicate user_id and profile ids: ${result.stderr}`);
  assert.equal(listed[1], userId);
  assert.deepEqual(
    listed[2].split(',').map((s) => s.trim()).sort(),
    [firstId, secondId].sort(),
  );

  // Pre-DDL abort: neither constraint applied, no schema_migrations row,
  // rows untouched (no auto-repair).
  assert.equal(await constraintExists('students', 'students_user_id_unique'), false);
  assert.equal(await constraintExists('teachers', 'teachers_user_id_unique'), false);
  const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [MIGRATION_005]);
  assert.equal(rows.length, 0, 'aborted migration must not record 005');
  const { rows: dupRows } = await pool.query('SELECT id FROM students WHERE user_id = $1', [userId]);
  assert.equal(dupRows.length, 2, 'no auto-repair: duplicate rows stay duplicated');

  // Restore the shared test DB to the migrated state.
  await pool.query('DELETE FROM students WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await ensureMigrated();
});

test('duplicates across two distinct students.user_id values list EVERY affected group (STU-006)', async () => {
  const firstUser = await insertUser();
  const secondUser = await insertUser();
  const firstIds = [randomUUID(), randomUUID()];
  const secondIds = [randomUUID(), randomUUID()];
  await dropUserUniques();
  await pool.query(
    `INSERT INTO students (id, user_id, nombres, apellidos, codalumno)
     VALUES ($1, $2, $3, $4, $5), ($6, $2, $3, $4, $7), ($8, $9, $3, $4, $10), ($11, $9, $3, $4, $12)`,
    [
      firstIds[0], firstUser, 'Ana', 'Lopez', 'DUPSTU3',
      firstIds[1], 'DUPSTU4',
      secondIds[0], secondUser, 'DUPSTU5',
      secondIds[1], 'DUPSTU6',
    ],
  );

  const result = await runMigrate();
  assert.equal(result.code, 1, `expected migrate to abort, got exit ${result.code}: ${result.stderr}`);
  const listed = result.stderr.match(/students\.user_id duplicates: (.+)$/m);
  assert.ok(listed, `stderr must list every duplicate user_id group: ${result.stderr}`);
  // The RAISE concatenates groups with '; ' — assert BOTH uuid -> {ids} pairs
  // survive the string_agg concatenation, not just the first match.
  const pairs = {};
  for (const group of listed[1].split('; ')) {
    const parsed = group.match(/^([0-9a-f-]+) -> \{([^}]+)\}$/);
    assert.ok(parsed, `malformed duplicate group "${group}" in: ${listed[1]}`);
    pairs[parsed[1]] = parsed[2].split(',').map((s) => s.trim()).sort();
  }
  assert.deepEqual(pairs, {
    [firstUser]: [firstIds[0], firstIds[1]].sort(),
    [secondUser]: [secondIds[0], secondIds[1]].sort(),
  });

  // Pre-DDL abort for the whole file.
  assert.equal(await constraintExists('students', 'students_user_id_unique'), false);
  assert.equal(await constraintExists('teachers', 'teachers_user_id_unique'), false);
  const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [MIGRATION_005]);
  assert.equal(rows.length, 0, 'aborted migration must not record 005');

  // Restore the shared test DB to the migrated state.
  await pool.query('DELETE FROM students WHERE user_id = ANY($1)', [[firstUser, secondUser]]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[firstUser, secondUser]]);
  await ensureMigrated();
});

test('duplicate teachers.user_id aborts the migration before any DDL, listing user_id and profile ids (TEA-005)', async () => {
  const userId = await insertUser();
  const firstId = randomUUID();
  const secondId = randomUUID();
  await dropUserUniques();
  await pool.query(
    `INSERT INTO teachers (id, user_id, nombres, apellidos)
     VALUES ($1, $2, $3, $4), ($5, $2, $3, $4)`,
    [firstId, userId, 'Ana', 'Lopez', secondId],
  );

  const result = await runMigrate();
  assert.equal(result.code, 1, `expected migrate to abort, got exit ${result.code}: ${result.stderr}`);
  const listed = result.stderr.match(
    /teachers\.user_id duplicates: ([0-9a-f-]+) -> \{([^}]+)\}/,
  );
  assert.ok(listed, `stderr must list the duplicate user_id and profile ids: ${result.stderr}`);
  assert.equal(listed[1], userId);
  assert.deepEqual(
    listed[2].split(',').map((s) => s.trim()).sort(),
    [firstId, secondId].sort(),
  );

  // Pre-DDL abort for the whole file: students ALTER (would run first) is
  // also absent, proving the raise stopped the file before any DDL.
  assert.equal(await constraintExists('students', 'students_user_id_unique'), false);
  assert.equal(await constraintExists('teachers', 'teachers_user_id_unique'), false);
  const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [MIGRATION_005]);
  assert.equal(rows.length, 0, 'aborted migration must not record 005');
  const { rows: dupRows } = await pool.query('SELECT id FROM teachers WHERE user_id = $1', [userId]);
  assert.equal(dupRows.length, 2, 'no auto-repair: duplicate rows stay duplicated');

  // Restore the shared test DB to the migrated state.
  await pool.query('DELETE FROM teachers WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await ensureMigrated();
});

test('a second students row for the same user_id is rejected with 23505 (STU-006)', async () => {
  await ensureMigrated();
  const userId = await insertUser();
  await pool.query(
    `INSERT INTO students (id, user_id, nombres, apellidos, codalumno)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), userId, 'Ana', 'Lopez', 'ONEPROF1'],
  );

  await assert.rejects(
    pool.query(
      `INSERT INTO students (id, user_id, nombres, apellidos, codalumno)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), userId, 'Eva', 'Gomez', 'ONEPROF2'],
    ),
    (error) => {
      assert.equal(error.code, '23505', 'second profile insert must hit a unique violation');
      assert.equal(error.constraint, 'students_user_id_unique');
      return true;
    },
  );

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM students WHERE user_id = $1', [
    userId,
  ]);
  assert.equal(rows[0].n, 1, 'no second students row exists');

  await pool.query('DELETE FROM students WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
});

test('a second teachers row for the same user_id is rejected with 23505 (TEA-005)', async () => {
  await ensureMigrated();
  const userId = await insertUser();
  await pool.query(
    `INSERT INTO teachers (id, user_id, nombres, apellidos)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, 'Ana', 'Lopez'],
  );

  await assert.rejects(
    pool.query(
      `INSERT INTO teachers (id, user_id, nombres, apellidos)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, 'Eva', 'Gomez'],
    ),
    (error) => {
      assert.equal(error.code, '23505', 'second profile insert must hit a unique violation');
      assert.equal(error.constraint, 'teachers_user_id_unique');
      return true;
    },
  );

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM teachers WHERE user_id = $1', [
    userId,
  ]);
  assert.equal(rows[0].n, 1, 'no second teachers row exists');

  await pool.query('DELETE FROM teachers WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
});
