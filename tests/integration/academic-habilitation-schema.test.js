import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import config from '../../src/config.ts';
import { cleanDb } from './helpers/clean-db.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const PERIODS = [
  { table: 'teacher_academic_habilitations', profile: 'teacher_id', profiles: 'teachers' },
  { table: 'student_academic_habilitations', profile: 'student_id', profiles: 'students' },
];

async function createUser(username) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
    [username, 'not-used-by-schema-test', 'admin'],
  );
  return rows[0].id;
}

async function createProfile(kind, username) {
  const userId = await createUser(username);
  const columns = kind === 'teacher'
    ? '(user_id, nombres, apellidos)'
    : '(user_id, nombres, apellidos, codalumno)';
  const values = kind === 'teacher' ? [userId, 'Ada', 'Lovelace'] : [userId, 'Ada', 'Lovelace', username];
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO ${kind === 'teacher' ? 'teachers' : 'students'} ${columns} VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return rows[0].id;
}

async function createSubject(name) {
  const { rows } = await pool.query('INSERT INTO subjects (name) VALUES ($1) RETURNING id', [name]);
  return rows[0].id;
}

async function createGroup(name) {
  const { rows } = await pool.query(
    `INSERT INTO academic_groups (academic_year, curriculum_semester, name)
     VALUES (2026, 5, $1) RETURNING id`,
    [name],
  );
  return rows[0].id;
}

async function createContext(name) {
  const subjectId = await createSubject(`${name} subject`);
  const groupId = await createGroup(`${name} group`);
  await pool.query(
    'INSERT INTO subject_academic_groups (subject_id, academic_group_id) VALUES ($1, $2)',
    [subjectId, groupId],
  );
  return { subjectId, groupId };
}

async function insertPeriod(period, profileId, actorId, context, extras = {}) {
  const { rows } = await pool.query(
    `INSERT INTO ${period.table}
       (${period.profile}, subject_id, academic_group_id, activated_by, activated_at, revoked_by, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [profileId, context.subjectId, context.groupId, actorId,
      Object.hasOwn(extras, 'activatedAt') ? extras.activatedAt : '2026-01-01T00:00:00Z',
      extras.revokedBy ?? null, extras.revokedAt ?? null],
  );
  return rows[0].id;
}

beforeEach(async () => {
  await cleanDb(pool);
});

after(async () => {
  try {
    await cleanDb(pool);
  } finally {
    await pool.end();
  }
});

test('teacher and student periods require existing profiles, actors, and associated contexts', async () => {
  for (const [index, period] of PERIODS.entries()) {
    const kind = index === 0 ? 'teacher' : 'student';
    const profileId = await createProfile(kind, `VALID${index}`);
    const actorId = await createUser(`ACTOR${index}`);
    const context = await createContext(`Valid${index}`);

    await assert.rejects(
      insertPeriod(period, '00000000-0000-0000-0000-000000000000', actorId, context),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      insertPeriod(period, profileId, '00000000-0000-0000-0000-000000000000', context),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      insertPeriod(period, profileId, actorId, context, {
        revokedBy: '00000000-0000-0000-0000-000000000000', revokedAt: '2026-02-01T00:00:00Z',
      }),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      insertPeriod(period, profileId, actorId, {
        subjectId: '00000000-0000-0000-0000-000000000000', groupId: context.groupId,
      }),
      (error) => error.code === '23503',
    );

    const unassociated = {
      subjectId: await createSubject(`Unassociated${index}`),
      groupId: await createGroup(`Unassociated${index}`),
    };
    await assert.rejects(
      insertPeriod(period, profileId, actorId, unassociated),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO ${period.table} (${period.profile}, subject_id, academic_group_id, activated_at)
         VALUES ($1, $2, $3, now())`,
        [profileId, context.subjectId, context.groupId],
      ),
      (error) => error.code === '23502',
    );
    await insertPeriod(period, profileId, actorId, context);
  }
});

test('active periods are unique per profile and context; close and reactivation preserve history', async () => {
  for (const [index, period] of PERIODS.entries()) {
    const kind = index === 0 ? 'teacher' : 'student';
    const profileId = await createProfile(kind, `HISTORY${index}`);
    const actorId = await createUser(`HISTORYACTOR${index}`);
    const otherActorId = await createUser(`CLOSER${index}`);
    const context = await createContext(`History${index}`);
    const firstId = await insertPeriod(period, profileId, actorId, context);

    await assert.rejects(
      insertPeriod(period, profileId, actorId, context),
      (error) => error.code === '23505',
    );
    await pool.query(
      `UPDATE ${period.table} SET revoked_by = $1, revoked_at = $2 WHERE id = $3`,
      [otherActorId, '2026-02-01T00:00:00Z', firstId],
    );
    const secondId = await insertPeriod(period, profileId, actorId, context, {
      activatedAt: '2026-03-01T00:00:00Z',
    });

    const otherContext = await createContext(`Other${index}`);
    await insertPeriod(period, profileId, actorId, otherContext);
    const { rows } = await pool.query(
      `SELECT id, revoked_by, revoked_at FROM ${period.table} WHERE ${period.profile} = $1 ORDER BY id`,
      [profileId],
    );
    assert.equal(rows.length, 3);
    assert.equal(rows.find(({ id }) => id === firstId).revoked_by, otherActorId);
    assert.ok(rows.find(({ id }) => id === firstId).revoked_at);
    assert.equal(rows.find(({ id }) => id === secondId).revoked_at, null);
  }
});

test('revocation fields are paired and revocation cannot predate activation', async () => {
  for (const [index, period] of PERIODS.entries()) {
    const profileId = await createProfile(index === 0 ? 'teacher' : 'student', `CHECK${index}`);
    const actorId = await createUser(`CHECKACTOR${index}`);
    const context = await createContext(`Check${index}`);
    for (const [revokedBy, revokedAt] of [[actorId, null], [null, '2026-02-01T00:00:00Z']]) {
      await assert.rejects(
        insertPeriod(period, profileId, actorId, context, { revokedBy, revokedAt }),
        (error) => error.code === '23514',
      );
    }
    await assert.rejects(
      insertPeriod(period, profileId, actorId, context, { activatedAt: null }),
      (error) => error.code === '23502',
    );
    await assert.rejects(
      insertPeriod(period, profileId, actorId, context, {
        activatedAt: '2026-02-01T00:00:00Z', revokedBy: actorId, revokedAt: '2026-01-31T23:59:59Z',
      }),
      (error) => error.code === '23514',
    );
  }
});

test('history prevents deletion of referenced profiles, actors, and contexts', async () => {
  for (const [index, period] of PERIODS.entries()) {
    const kind = index === 0 ? 'teacher' : 'student';
    const profileId = await createProfile(kind, `RESTRICT${index}`);
    const actorId = await createUser(`RESTRICTACTOR${index}`);
    const closerId = await createUser(`RESTRICTCLOSER${index}`);
    const context = await createContext(`Restrict${index}`);
    const periodId = await insertPeriod(period, profileId, actorId, context);
    await pool.query(
      `UPDATE ${period.table} SET revoked_by = $1, revoked_at = $2 WHERE id = $3`,
      [closerId, '2026-02-01T00:00:00Z', periodId],
    );

    await assert.rejects(
      pool.query(`DELETE FROM ${period.profiles} WHERE id = $1`, [profileId]),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      pool.query('DELETE FROM users WHERE id = $1', [actorId]),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      pool.query('DELETE FROM users WHERE id = $1', [closerId]),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      pool.query('DELETE FROM subject_academic_groups WHERE subject_id = $1 AND academic_group_id = $2',
        [context.subjectId, context.groupId]),
      (error) => error.code === '23503',
    );
  }
});
