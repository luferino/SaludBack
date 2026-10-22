import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';

// No shared-data cleanup: every fixture and migration lives in a fresh schema
// inside one transaction. ROLLBACK removes only this test's uncommitted work.
const ID = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = ID(1), TEACHER_ACCOUNT = ID(2), OTHER_ACCOUNT = ID(3);
const TEACHER = ID(11), OTHER_TEACHER = ID(12), STUDENT = ID(21), UNASSIGNED = ID(22);
const SUBJECT = 'abcdefab-0000-4000-8000-000000000031', OTHER_SUBJECT = ID(32), GROUP = ID(41), OTHER_GROUP = ID(42);
const ACTIVE = ID(61), REVOKED = ID(62), OUTSIDE = ID(63), TEACHER_PERIOD = ID(51);

async function isolatedApp(run) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  const client = await pool.connect();
  let server;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const schema = `academic_read_test_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    assert.equal((await client.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    for (const name of [
      '001_create_users.sql', '002_create_patients.sql', '003_add_email_and_reset_tokens.sql',
      '004_multi_role_and_audit.sql', '005_user_id_unique_profiles.sql', '006_create_permission_matrix.sql',
      '009_create_academic_contexts.sql', '010_create_academic_habilitations.sql',
      '027_seed_profile_read_permissions.sql', '028_seed_habilitation_read_permissions.sql',
    ]) {
      await client.query(await readFile(new URL(`../../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    }
    for (const [id, role] of [[ADMIN, 'admin'], [TEACHER_ACCOUNT, 'teacher'], [OTHER_ACCOUNT, 'teacher'], [ID(4), 'estudiante'], [ID(5), 'estudiante']]) {
      await client.query('INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,$4)', [id, id, 'never-expose-hash', role]);
    }
    for (const [id, user] of [[TEACHER, TEACHER_ACCOUNT], [OTHER_TEACHER, OTHER_ACCOUNT]]) {
      await client.query('INSERT INTO teachers (id,user_id,nombres,apellidos,email,celular) VALUES ($1,$2,$3,$4,$5,$6)', [id, user, 'Ada', 'Same', 'private@example.invalid', 'private']);
    }
    for (const [id, user, code] of [[STUDENT, ID(4), 'A1'], [UNASSIGNED, ID(5), 'A2']]) {
      await client.query('INSERT INTO students (id,user_id,nombres,apellidos,codalumno,email,celular) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, user, 'Ana', 'Same', code, 'private@example.invalid', 'private']);
    }
    for (const id of [SUBJECT, OTHER_SUBJECT]) await client.query('INSERT INTO subjects (id,name) VALUES ($1,$2)', [id, id]);
    for (const id of [GROUP, OTHER_GROUP]) await client.query('INSERT INTO academic_groups (id,academic_year,curriculum_semester,name) VALUES ($1,2026,1,$2)', [id, id]);
    for (const [subject, group] of [[SUBJECT, GROUP], [OTHER_SUBJECT, OTHER_GROUP]]) {
      await client.query('INSERT INTO subject_academic_groups (subject_id,academic_group_id) VALUES ($1,$2)', [subject, group]);
    }
    await client.query(`INSERT INTO teacher_academic_habilitations (id,teacher_id,subject_id,academic_group_id,activated_by,activated_at)
      VALUES ($1,$2,$3,$4,$5,'2026-01-01'),($6,$7,$8,$9,$5,'2026-01-01')`,
    [TEACHER_PERIOD, TEACHER, SUBJECT, GROUP, ADMIN, ID(52), OTHER_TEACHER, OTHER_SUBJECT, OTHER_GROUP]);
    await client.query(`INSERT INTO student_academic_habilitations (id,student_id,subject_id,academic_group_id,activated_by,activated_at,revoked_by,revoked_at)
      VALUES ($1,$2,$3,$4,$5,'2026-01-03',NULL,NULL),
             ($6,$2,$3,$4,$5,'2026-01-02',$5,'2026-01-03'),
             ($7,$2,$8,$9,$5,'2026-01-04',NULL,NULL)`,
    [ACTIVE, STUDENT, SUBJECT, GROUP, ADMIN, REVOKED, OUTSIDE, OTHER_SUBJECT, OTHER_GROUP]);
    const [{ createApp }, { JwtTokenService }] = await Promise.all([
      import('../../src/app.ts'), import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
    ]);
    // GET routes use only query(); connect() fails closed to catch accidental writes.
    const readPool = { query: (...args) => client.query(...args), connect: async () => { throw new Error('Read endpoint attempted a transaction'); } };
    server = createServer(createApp(readPool));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const service = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: process.env.JWT_SECRET_KID || 'default', previousSecrets: [], expiresIn: '1h' });
    const tokens = {
      admin: await service.sign({ role: 'admin', sub: ADMIN }),
      teacher: await service.sign({ role: 'teacher', sub: TEACHER_ACCOUNT }),
      noProfile: await service.sign({ role: 'teacher', sub: ADMIN }),
      writeOnly: await service.sign({ role: 'writer', sub: TEACHER_ACCOUNT, permissions: ['students:read', 'student-habilitations:read'] }),
    };
    const get = async (path, role = 'admin') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: role ? { authorization: `Bearer ${tokens[role]}` } : {} });
      return { status: response.status, body: await response.json() };
    };
    await run({ get, client });
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}

test('academic read API on isolated PostgreSQL state', async (t) => {
  await isolatedApp(async ({ get, client }) => {
    await t.test('selectors expose profile identities, exact minimal keys and stable pages', async () => {
      for (const [path, expected, keys] of [
        ['/teachers', [TEACHER, OTHER_TEACHER], ['id', 'nombres', 'apellidos']],
        ['/students', [STUDENT, UNASSIGNED], ['id', 'nombres', 'apellidos', 'codalumno']],
      ]) {
        const all = await get(path);
        assert.equal(all.status, 200);
        assert.equal(all.body.limit, 50);
        assert.equal(all.body.offset, 0);
        assert.deepEqual(all.body.items.map((item) => item.id), expected);
        for (const item of all.body.items) assert.deepEqual(Object.keys(item).sort(), keys.sort());
        for (let offset = 0; offset < 2; offset++) {
          const page = await get(`${path}?limit=1&offset=${offset}`);
          assert.deepEqual(page, { status: 200, body: { items: [all.body.items[offset]], limit: 1, offset } });
        }
        assert.deepEqual((await get(`${path}?offset=10000&limit=100`)).body, { items: [], limit: 100, offset: 10000 });
      }
      assert.equal((await get('/students', 'teacher')).body.items.length, 2); // Includes unassigned profile.
    });
    await t.test('period history, actor accounts, all filters and stable ordering', async () => {
      const all = await get('/student-habilitations');
      assert.equal(all.status, 200);
      assert.deepEqual(all.body.items.map((row) => row.id), [OUTSIDE, ACTIVE, REVOKED]);
      const keys = ['id', 'student_id', 'subject_id', 'academic_group_id', 'activated_by', 'activated_at', 'revoked_by', 'revoked_at'];
      for (const row of all.body.items) assert.deepEqual(Object.keys(row).sort(), keys.sort());
      assert.equal(all.body.items[0].activated_by, ADMIN);
      assert.equal(all.body.items[0].activated_at, '2026-01-04T00:00:00.000Z');
      for (const [filter, ids] of [
        [`student_id=${STUDENT}`, [OUTSIDE, ACTIVE, REVOKED]],
        [`subject_id=${SUBJECT}`, [ACTIVE, REVOKED]],
        [`academic_group_id=${GROUP}`, [ACTIVE, REVOKED]],
        ['status=active', [OUTSIDE, ACTIVE]], ['status=revoked', [REVOKED]],
        [`student_id=${UNASSIGNED}`, []],
        [`student_id=${STUDENT}&subject_id=${SUBJECT}&academic_group_id=${GROUP}&status=revoked`, [REVOKED]],
      ]) assert.deepEqual((await get(`/student-habilitations?${filter}`)).body.items.map((row) => row.id), ids);
      const uppercase = await get(`/student-habilitations?subject_id=${SUBJECT.toUpperCase()}`, 'teacher');
      assert.equal(uppercase.status, 200);
      assert.deepEqual(uppercase.body.items.map((row) => row.id), [ACTIVE, REVOKED]);
      assert.deepEqual((await get('/student-habilitations?limit=1&offset=1', 'teacher')).body.items.map((row) => row.id), [REVOKED]);
      const teacher = await get(`/teacher-habilitations?teacher_id=${TEACHER}&subject_id=${SUBJECT}&academic_group_id=${GROUP}&status=active`);
      assert.equal(teacher.status, 200);
      assert.deepEqual(teacher.body.items.map((row) => row.id), [TEACHER_PERIOD]);
      assert.deepEqual(Object.keys(teacher.body.items[0]).sort(), keys.map((key) => key === 'student_id' ? 'teacher_id' : key).sort());
      assert.deepEqual((await get('/teacher-habilitations?status=revoked')).body.items, []);
    });
    await t.test('permission failures and invalid inputs preserve the public history and selector state', async () => {
      await client.query("INSERT INTO permissions (permission) VALUES ('students:write'),('student-habilitations:write')");
      await client.query("INSERT INTO role_permissions (role,permission) VALUES ('writer','students:write'),('writer','student-habilitations:write')");
      const paths = ['/teachers', '/students', '/teacher-habilitations', '/student-habilitations'];
      const before = [];
      for (const path of paths) before.push(await get(path));
      for (const path of paths) {
        for (const [role, expected] of [[null, 401], ['writeOnly', 403]]) {
          const rejected = await get(path, role);
          assert.equal(rejected.status, expected);
          assert.equal(rejected.body.error.code, expected === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
        }
        for (const query of ['limit=0', 'limit=101', 'offset=10001', 'offset=-1', 'limit=', 'limit=1.5', 'limit=1&limit=2']) {
          const rejected = await get(`${path}?${query}`);
          assert.equal(rejected.status, 400, `${path}?${query}`);
          assert.equal(rejected.body.error.code, 'BAD_REQUEST');
        }
      }
      for (const path of ['/teacher-habilitations', '/student-habilitations']) {
        for (const query of ['subject_id=bad', 'academic_group_id=', 'status=invalid', 'status=active&status=revoked']) assert.equal((await get(`${path}?${query}`)).status, 400);
      }
      for (const path of ['/teachers', '/teacher-habilitations']) assert.equal((await get(path, 'teacher')).status, 403);
      assert.equal((await get('/student-habilitations', 'noProfile')).status, 403);
      const after = [];
      for (const path of paths) after.push(await get(path));
      assert.deepEqual(after, before);
    });
    await t.test('teacher scope is live and applied before paging; explicit outside contexts are denied', async () => {
      assert.deepEqual((await get('/student-habilitations', 'teacher')).body.items.map((row) => row.id), [ACTIVE, REVOKED]);
      for (const query of [`subject_id=${OTHER_SUBJECT}`, `academic_group_id=${OTHER_GROUP}`, `subject_id=${SUBJECT}&academic_group_id=${OTHER_GROUP}`]) {
        assert.equal((await get(`/student-habilitations?${query}`, 'teacher')).status, 403);
      }
      await client.query('UPDATE teacher_academic_habilitations SET revoked_by=$1,revoked_at=now() WHERE id=$2', [ADMIN, TEACHER_PERIOD]);
      assert.equal((await get('/student-habilitations', 'teacher')).status, 403);
      assert.equal((await get('/student-habilitations')).body.items.length, 3);
      await client.query("DELETE FROM role_permissions WHERE role='admin' AND permission='student-habilitations:read'");
      assert.equal((await get('/student-habilitations')).status, 403); // Same token, no admin bypass.
      await client.query("DELETE FROM role_permissions WHERE role='teacher' AND permission='students:read'");
      assert.equal((await get('/students', 'teacher')).status, 403);
    });
  });
});
