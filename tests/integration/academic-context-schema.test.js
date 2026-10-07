import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import config from '../../src/config.ts';
import { cleanDb } from './helpers/clean-db.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

async function createSubject(name = 'Mathematics') {
  const { rows } = await pool.query(
    'INSERT INTO subjects (name) VALUES ($1) RETURNING id',
    [name],
  );
  return rows[0].id;
}

async function createGroup({ academicYear = 2026, curriculumSemester = 5, name = 'A' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO academic_groups (academic_year, curriculum_semester, name)
     VALUES ($1, $2, $3) RETURNING id`,
    [academicYear, curriculumSemester, name],
  );
  return rows[0].id;
}

async function associate(subjectId, groupId) {
  await pool.query(
    'INSERT INTO subject_academic_groups (subject_id, academic_group_id) VALUES ($1, $2)',
    [subjectId, groupId],
  );
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

test('a group is shared across subjects and a subject can use multiple groups', async () => {
  const mathematicsId = await createSubject('Mathematics');
  const physicsId = await createSubject('Physics');
  const firstGroupId = await createGroup();
  const secondGroupId = await createGroup({ name: 'B' });

  await associate(mathematicsId, firstGroupId);
  await associate(physicsId, firstGroupId);
  await associate(mathematicsId, secondGroupId);

  const { rows } = await pool.query(
    'SELECT subject_id, academic_group_id FROM subject_academic_groups ORDER BY subject_id, academic_group_id',
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(
    new Set(rows.map(({ subject_id }) => subject_id)),
    new Set([mathematicsId, physicsId]),
  );
  assert.equal(rows.filter(({ academic_group_id }) => academic_group_id === firstGroupId).length, 2);
});

test('group identity is unique by academic year, curriculum semester, and name', async () => {
  await createGroup({ academicYear: 2026, curriculumSemester: 5, name: 'A' });
  await assert.rejects(
    createGroup({ academicYear: 2026, curriculumSemester: 5, name: 'A' }),
    (error) => error.code === '23505',
  );

  await createGroup({ academicYear: 2026, curriculumSemester: 6, name: 'A' });
  await createGroup({ academicYear: 2027, curriculumSemester: 5, name: 'A' });
  await createGroup({ academicYear: 2026, curriculumSemester: 5, name: 'B' });
});

test('catalog names are required and nonblank; year and curriculum semester are positive', async () => {
  for (const value of [null, '', '   ']) {
    await assert.rejects(
      pool.query('INSERT INTO subjects (name) VALUES ($1)', [value]),
      (error) => ['23502', '23514'].includes(error.code),
    );
    await assert.rejects(
      pool.query(
        'INSERT INTO academic_groups (academic_year, curriculum_semester, name) VALUES (2026, 5, $1)',
        [value],
      ),
      (error) => ['23502', '23514'].includes(error.code),
    );
  }

  for (const [academicYear, curriculumSemester] of [[0, 1], [-1, 1], [2026, 0], [2026, -1]]) {
    await assert.rejects(
      pool.query(
        `INSERT INTO academic_groups (academic_year, curriculum_semester, name)
         VALUES ($1, $2, 'A')`,
        [academicYear, curriculumSemester],
      ),
      (error) => error.code === '23514',
    );
  }

  for (const [academicYear, curriculumSemester] of [[null, 1], [2026, null]]) {
    await assert.rejects(
      pool.query(
        `INSERT INTO academic_groups (academic_year, curriculum_semester, name)
         VALUES ($1, $2, 'A')`,
        [academicYear, curriculumSemester],
      ),
      (error) => error.code === '23502',
    );
  }
});

test('subject-group pairs are unique and both references must exist', async () => {
  const subjectId = await createSubject();
  const groupId = await createGroup();
  await associate(subjectId, groupId);

  await assert.rejects(
    associate(subjectId, groupId),
    (error) => error.code === '23505',
  );
  await assert.rejects(
    associate('00000000-0000-0000-0000-000000000000', groupId),
    (error) => error.code === '23503',
  );
  await assert.rejects(
    associate(subjectId, '00000000-0000-0000-0000-000000000000'),
    (error) => error.code === '23503',
  );
  await assert.rejects(
    pool.query('INSERT INTO subject_academic_groups (subject_id, academic_group_id) VALUES (NULL, $1)', [groupId]),
    (error) => error.code === '23502',
  );
  await assert.rejects(
    pool.query('INSERT INTO subject_academic_groups (subject_id, academic_group_id) VALUES ($1, NULL)', [subjectId]),
    (error) => error.code === '23502',
  );
});

test('referenced subjects and groups cannot be deleted while associations exist', async () => {
  const subjectId = await createSubject();
  const groupId = await createGroup();
  await associate(subjectId, groupId);

  await assert.rejects(
    pool.query('DELETE FROM subjects WHERE id = $1', [subjectId]),
    (error) => error.code === '23503',
  );
  await assert.rejects(
    pool.query('DELETE FROM academic_groups WHERE id = $1', [groupId]),
    (error) => error.code === '23503',
  );
});

test('catalog and association tables use UUID keys and nullable actor bookkeeping', async () => {
  const { rows } = await pool.query(
    `SELECT table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name IN ('subjects', 'academic_groups', 'subject_academic_groups')`,
  );
  const column = (tableName, columnName) => rows.find(
    (row) => row.table_name === tableName && row.column_name === columnName,
  );

  assert.equal(column('subjects', 'id').data_type, 'uuid');
  assert.equal(column('academic_groups', 'id').data_type, 'uuid');
  assert.equal(column('subject_academic_groups', 'subject_id').data_type, 'uuid');
  assert.equal(column('subjects', 'created_by').is_nullable, 'YES');
  assert.equal(column('subjects', 'updated_by').is_nullable, 'YES');
  assert.equal(column('academic_groups', 'updated_at').is_nullable, 'YES');
  assert.equal(rows.some(({ column_name }) => column_name === 'status'), false);
});
