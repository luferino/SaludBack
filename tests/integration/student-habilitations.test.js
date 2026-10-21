import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';

const MIGRATIONS = [
  '001_create_users.sql', '002_create_patients.sql', '003_add_email_and_reset_tokens.sql',
  '004_multi_role_and_audit.sql', '005_user_id_unique_profiles.sql',
  '006_create_permission_matrix.sql', '007_seed_permission_matrix.sql',
  '008_create_clinical_records.sql', '009_create_academic_contexts.sql',
  '010_create_academic_habilitations.sql', '011_seed_subject_permissions.sql',
  '012_seed_group_permissions.sql', '013_seed_subject_group_permissions.sql',
  '014_seed_teacher_habilitation_permissions.sql',
  '015_seed_teacher_habilitation_revocation_permission.sql',
  '016_seed_student_habilitation_permissions.sql',
  '017_create_patient_assignments.sql', '018_seed_patient_assignment_permissions.sql',
  '019_seed_student_habilitation_revocation_permission.sql',
  '020_create_kinesiology_evaluations.sql', '021_seed_kinesiology_evaluation_permissions.sql',
  '022_create_kinesiology_consent_attestations.sql', '023_create_kinesiology_submissions.sql',
];
const APP_NAME = 'student-habilitations-integration';
const PG_OPTIONS = '-c search_path=pg_catalog,public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000';
const TIMEOUT = 5000;
const REQUEST_TIMEOUT = 9000;

let pool;
let server;
let baseUrl;
let config;
let cleanDb;
let JwtTokenService;
let sequence = 0;

function check(condition, message) {
  assert.ok(condition, message);
}

function databaseUrlFromFile() {
  const line = readFileSync('.env.test', 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)?.[1];
  assert.ok(line, '.env.test must define DATABASE_URL');
  return line.replace(/^(["'])(.*)\1$/, '$2');
}

function normalizedAddress(address) {
  if (!address) return null;
  const bare = address.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase();
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? mapped[1] : bare;
}

function isLoopback(address) {
  const normalized = normalizedAddress(address);
  if (!normalized) return false;
  return net.isIP(normalized) === 4
    ? normalized.startsWith('127.')
    : normalized === '::1';
}

async function verifyDisposableTarget() {
  const fileUrl = databaseUrlFromFile();
  assert.equal(process.env.DATABASE_URL, fileUrl, 'effective DATABASE_URL must exactly match .env.test');
  const url = new URL(fileUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(url.hostname && url.port && url.username && url.password && !url.search && !url.hash);
  const database = decodeURIComponent(url.pathname.slice(1));
  assert.match(database, /(?:^|[_-])(?:test|testing)(?:$|[_-])/i,
    'database name must explicitly identify a test target');
  assert.doesNotMatch(database, /prod|production|develop|development/i);
  assert.doesNotMatch(process.env.NODE_ENV ?? '', /production/i);
  assert.doesNotMatch(process.env.APP_ENV ?? '', /production/i);

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const resolved = await dns.lookup(hostname, { all: true });
  assert.ok(resolved.length > 0 && resolved.every(({ address }) => isLoopback(address)),
    'configured host must resolve only to loopback');
  const resolvedAddresses = new Set(resolved.map(({ address }) => normalizedAddress(address)));

  const client = new pg.Client({
    connectionString: fileUrl,
    connectionTimeoutMillis: TIMEOUT,
    statement_timeout: TIMEOUT,
    query_timeout: TIMEOUT + 1000,
    options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000',
  });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT current_database() AS database_name, current_user AS database_user,
             inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
             inet_client_addr()::text AS client_address,
             current_setting('transaction_read_only') AS read_only`);
    assert.equal(rows.length, 1);
    const identity = rows[0];
    const socket = client.connection.stream;
    assert.equal(identity.database_name, database);
    assert.equal(identity.database_user, decodeURIComponent(url.username));
    assert.equal(Number(identity.server_port), Number(url.port));
    assert.equal(identity.read_only, 'on');
    assert.ok(resolvedAddresses.has(normalizedAddress(identity.server_address)),
      'PostgreSQL server peer must match a resolved configured loopback address');
    for (const address of [identity.server_address, identity.client_address,
      socket.remoteAddress, socket.localAddress]) {
      assert.ok(isLoopback(address), 'database and socket peers must be loopback');
    }
    assert.equal(normalizedAddress(socket.remoteAddress), normalizedAddress(identity.server_address));
    await client.query('ROLLBACK');

    const { rows: ledger } = await client.query('SELECT name FROM public.schema_migrations ORDER BY name');
    assert.deepEqual(ledger.map(({ name }) => name), MIGRATIONS,
      'the complete expected migration ledger must exist before fixture cleanup');
    const { rows: required } = await client.query(`
      SELECT tablename FROM pg_catalog.pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])
       ORDER BY tablename`, [[
      'kinesiology_evaluation_submission_studies', 'kinesiology_evaluation_submissions',
      'kinesiology_consent_attestations', 'kinesiology_evaluations', 'patient_assignments', 'student_academic_habilitations', 'teacher_academic_habilitations', 'students', 'teachers',
      'subject_academic_groups', 'academic_groups', 'subjects', 'clinical_records', 'patients',
      'password_reset_tokens', 'users', 'permissions', 'role_permissions', 'schema_migrations',
    ]]);
    assert.equal(required.length, 19, 'required integration schema is incomplete');
  } finally {
    await client.end();
  }
  return fileUrl;
}

function nextName(prefix) {
  sequence += 1;
  return `${prefix}_${process.pid}_${sequence}_${randomUUID().slice(0, 8)}`;
}

async function seedUser(role, name = nextName(role)) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
    [name, 'not-a-real-hash', role],
  );
  return { id: rows[0].id, username: name, role };
}

async function seedTeacher(user) {
  const { rows } = await pool.query(
    'INSERT INTO teachers (user_id, nombres, apellidos) VALUES ($1, $2, $3) RETURNING id',
    [user.id, 'Grace', 'Hopper'],
  );
  return rows[0].id;
}

async function seedStudent() {
  const user = await seedUser('estudiante');
  const codalumno = `STU${process.pid}${sequence}${randomUUID().replaceAll('-', '')}`;
  const { rows } = await pool.query(
    'INSERT INTO students (user_id, nombres, apellidos, codalumno) VALUES ($1, $2, $3, $4) RETURNING id',
    [user.id, 'Katherine', 'Johnson', codalumno],
  );
  return rows[0].id;
}

async function seedContext(name = nextName('context')) {
  const { rows: subjects } = await pool.query('INSERT INTO subjects (name) VALUES ($1) RETURNING id', [`${name}_subject`]);
  const { rows: groups } = await pool.query(
    `INSERT INTO academic_groups (academic_year, curriculum_semester, name)
     VALUES (2098, 1, $1) RETURNING id`, [`${name}_group`]);
  await pool.query(
    'INSERT INTO subject_academic_groups (subject_id, academic_group_id) VALUES ($1, $2)',
    [subjects[0].id, groups[0].id],
  );
  return { subjectId: subjects[0].id, groupId: groups[0].id };
}

async function seedTeacherPeriod(teacherId, context, actorId) {
  const { rows } = await pool.query(
    `INSERT INTO teacher_academic_habilitations
       (teacher_id, subject_id, academic_group_id, activated_by, activated_at)
     VALUES ($1, $2, $3, $4, clock_timestamp()) RETURNING id`,
    [teacherId, context.subjectId, context.groupId, actorId],
  );
  return rows[0].id;
}

async function fixture() {
  const admin = await seedUser('admin');
  const teacher = await seedUser('teacher');
  const teacherId = await seedTeacher(teacher);
  const context = await seedContext();
  const teacherPeriodId = await seedTeacherPeriod(teacherId, context, admin.id);
  const studentId = await seedStudent();
  return { admin, teacher, teacherId, context, teacherPeriodId, studentId };
}

async function tokenFor(user, permissions = []) {
  return new JwtTokenService({
    secret: config.jwtSecret,
    secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets,
    expiresIn: config.jwtExpiresIn,
  }).sign({ role: user.role, sub: user.id, username: user.username, permissions });
}

async function request(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

function activationBody(studentId, context, actorId) {
  return {
    student_id: studentId,
    subject_id: context.subjectId,
    academic_group_id: context.groupId,
    activated_by: actorId,
    actor: actorId,
  };
}

function expectedError(code, message) {
  return { error: { code, message } };
}

async function activePeriods(studentId) {
  const { rows } = await pool.query(
    `SELECT id, student_id, subject_id, academic_group_id, activated_by, activated_at,
            revoked_by, revoked_at
       FROM student_academic_habilitations WHERE student_id = $1 ORDER BY id`, [studentId]);
  return rows;
}

async function waitForLock(queryFragment) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`
      SELECT pid FROM pg_catalog.pg_stat_activity
       WHERE datname = current_database() AND application_name = $1
         AND state = 'active' AND wait_event_type = 'Lock' AND query ILIKE $2
       LIMIT 1`, [APP_NAME, `%${queryFragment}%`]);
    if (rows.length) return rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for observed PostgreSQL lock on ${queryFragment}`);
}

before(async () => {
  const databaseUrl = await verifyDisposableTarget();
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().startsWith('PG') || key.toUpperCase() === 'NODE_PG_FORCE_NATIVE') delete process.env[key];
  }
  process.env.PGOPTIONS = PG_OPTIONS;
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_PREVIOUS_SECRETS ??= '[]';
  process.env.PORT = '0';

  ({ default: config } = await import('../../src/config.ts'));
  ({ cleanDb } = await import('./helpers/clean-db.js'));
  ({ JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
  const { createApp } = await import('../../src/app.ts');
  pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: APP_NAME,
    max: 12,
    connectionTimeoutMillis: TIMEOUT,
    statement_timeout: TIMEOUT,
    query_timeout: TIMEOUT + 1000,
    lock_timeout: TIMEOUT,
    idle_in_transaction_session_timeout: TIMEOUT,
    options: PG_OPTIONS,
  });
  const app = createApp(pool);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await cleanDb(pool);
});

after(async () => {
  const errors = [];
  if (pool) {
    try { await cleanDb(pool); } catch (error) { errors.push(error); }
  }
  if (server) {
    try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    catch (error) { errors.push(error); }
  }
  if (pool) {
    try { await pool.end(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Student habilitation integration cleanup failed.');
});

test('authorized teacher activation persists exact period fields and rejects duplicate without extra history', async () => {
  const f = await fixture();
  const token = await tokenFor(f.teacher, ['student-habilitations:write']);
  const created = await request('POST', '/student-habilitations', {
    token, body: activationBody(f.studentId, f.context, f.admin.id),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), [
    'academic_group_id', 'activated_at', 'activated_by', 'id', 'revoked_at', 'revoked_by', 'student_id', 'subject_id',
  ]);
  assert.match(created.body.id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual({
    student_id: created.body.student_id,
    subject_id: created.body.subject_id,
    academic_group_id: created.body.academic_group_id,
    activated_by: created.body.activated_by,
    revoked_by: created.body.revoked_by,
    revoked_at: created.body.revoked_at,
  }, {
    student_id: f.studentId,
    subject_id: f.context.subjectId,
    academic_group_id: f.context.groupId,
    activated_by: f.teacher.id,
    revoked_by: null,
    revoked_at: null,
  });
  assert.equal(new Date(created.body.activated_at).toISOString(), created.body.activated_at);

  const duplicate = await request('POST', '/student-habilitations', {
    token, body: activationBody(f.studentId, f.context, f.admin.id),
  });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, expectedError('CONFLICT', 'student is already active in this subject and academic group'));
  const rows = await activePeriods(f.studentId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, created.body.id);
  assert.equal(rows[0].activated_by, f.teacher.id);
  assert.equal(rows[0].revoked_at, null);
});

test('permission, teacher profile, and context are required before target existence is disclosed', async () => {
  const f = await fixture();
  const teacherToken = await tokenFor(f.teacher, ['student-habilitations:write']);
  const studentMissing = '00000000-0000-0000-0000-000000000000';

  const noToken = await request('POST', '/student-habilitations', {
    body: activationBody(f.studentId, f.context, f.teacher.id),
  });
  assert.equal(noToken.status, 401);
  assert.deepEqual(noToken.body, expectedError('UNAUTHORIZED', 'Invalid or missing token'));

  await pool.query("DELETE FROM role_permissions WHERE role = 'teacher' AND permission = 'student-habilitations:write'");
  const permissionDenied = await request('POST', '/student-habilitations', {
    token: teacherToken, body: activationBody(f.studentId, f.context, f.teacher.id),
  });
  assert.equal(permissionDenied.status, 403);
  assert.deepEqual(permissionDenied.body, expectedError('FORBIDDEN', "Permission 'student-habilitations:write' required"));
  await pool.query("INSERT INTO role_permissions (role, permission) VALUES ('teacher', 'student-habilitations:write')");

  const adminToken = await tokenFor(f.admin, ['student-habilitations:write']);
  const adminDenied = await request('POST', '/student-habilitations', {
    token: adminToken, body: activationBody(f.studentId, f.context, f.admin.id),
  });
  assert.equal(adminDenied.status, 403);
  assert.deepEqual(adminDenied.body, expectedError('FORBIDDEN', "Permission 'student-habilitations:write' required"));

  const noProfile = await seedUser('teacher');
  const noProfileDenied = await request('POST', '/student-habilitations', {
    token: await tokenFor(noProfile, ['student-habilitations:write']),
    body: activationBody(f.studentId, f.context, noProfile.id),
  });
  assert.equal(noProfileDenied.status, 403);
  assert.deepEqual(noProfileDenied.body, expectedError('FORBIDDEN', 'an active teacher context is required'));

  const unrelatedContext = await seedContext();
  const noContext = await request('POST', '/student-habilitations', {
    token: teacherToken, body: activationBody(studentMissing, unrelatedContext, f.teacher.id),
  });
  assert.equal(noContext.status, 403);
  assert.deepEqual(noContext.body, expectedError('FORBIDDEN', 'an active teacher context is required'));
  assert.deepEqual(await activePeriods(f.studentId), []);
});

test('an authorized context returns exact not-found response for a missing student with no inserted period', async () => {
  const f = await fixture();
  const response = await request('POST', '/student-habilitations', {
    token: await tokenFor(f.teacher, ['student-habilitations:write']),
    body: activationBody('00000000-0000-0000-0000-000000000000', f.context, f.teacher.id),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, expectedError('NOT_FOUND', 'student was not found'));
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM student_academic_habilitations');
  assert.equal(rows[0].count, 0);
});

test('concurrent duplicate public requests commit exactly one active period', async () => {
  const f = await fixture();
  const token = await tokenFor(f.teacher, ['student-habilitations:write']);
  const body = activationBody(f.studentId, f.context, f.teacher.id);
  const results = await Promise.all([
    request('POST', '/student-habilitations', { token, body }),
    request('POST', '/student-habilitations', { token, body }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort((a, b) => a - b), [201, 409]);
  assert.deepEqual(results.find(result => result.status === 409).body,
    expectedError('CONFLICT', 'student is already active in this subject and academic group'));
  const rows = await activePeriods(f.studentId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].activated_by, f.teacher.id);
  assert.equal(rows[0].revoked_at, null);
});

test('when teacher revocation owns the context lock, pending activation revalidates and inserts nothing', async () => {
  const f = await fixture();
  const blocker = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: TIMEOUT,
    statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 1000, lock_timeout: TIMEOUT,
    application_name: `${APP_NAME}-blocker`, options: PG_OPTIONS });
  await blocker.connect();
  let transaction = false;
  try {
    await blocker.query('BEGIN'); transaction = true;
    await blocker.query('UPDATE teacher_academic_habilitations SET revoked_by = $1, revoked_at = clock_timestamp() WHERE id = $2', [f.admin.id, f.teacherPeriodId]);
    const pending = request('POST', '/student-habilitations', {
      token: await tokenFor(f.teacher, ['student-habilitations:write']),
      body: activationBody(f.studentId, f.context, f.admin.id),
    });
    await waitForLock('teacher_academic_habilitations');
    await blocker.query('COMMIT'); transaction = false;
    const rejected = await pending;
    assert.equal(rejected.status, 403);
    assert.deepEqual(rejected.body, expectedError('FORBIDDEN', 'an active teacher context is required'));
    assert.deepEqual(await activePeriods(f.studentId), []);
    const { rows } = await pool.query('SELECT revoked_by, revoked_at FROM teacher_academic_habilitations WHERE id = $1', [f.teacherPeriodId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revoked_by, f.admin.id);
    assert.ok(rows[0].revoked_at);
  } finally {
    if (transaction) await blocker.query('ROLLBACK').catch(() => {});
    await blocker.end();
  }
});

test('when activation owns the context lock, public teacher revocation waits for its commit', async () => {
  const f = await fixture();
  const blocker = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: TIMEOUT,
    statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 1000, lock_timeout: TIMEOUT,
    application_name: `${APP_NAME}-blocker`, options: PG_OPTIONS });
  await blocker.connect();
  let transaction = false;
  try {
    await blocker.query('BEGIN'); transaction = true;
    await blocker.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [f.studentId]);
    const activation = request('POST', '/student-habilitations', {
      token: await tokenFor(f.teacher, ['student-habilitations:write']),
      body: activationBody(f.studentId, f.context, f.teacher.id),
    });
    await waitForLock('FROM students');
    const revocation = request('POST', `/teacher-habilitations/${f.teacherPeriodId}/revoke`, {
      token: await tokenFor(f.admin, ['teacher-habilitations:revoke']),
    });
    await waitForLock('UPDATE teacher_academic_habilitations');
    await blocker.query('COMMIT'); transaction = false;
    const [activated, revoked] = await Promise.all([activation, revocation]);
    assert.equal(activated.status, 201);
    assert.equal(activated.body.activated_by, f.teacher.id);
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.revoked_by, f.admin.id);
    const periods = await activePeriods(f.studentId);
    assert.equal(periods.length, 1);
    assert.equal(periods[0].id, activated.body.id);
    assert.equal(periods[0].activated_by, f.teacher.id);
    assert.equal(periods[0].revoked_at, null);
    const { rows } = await pool.query('SELECT revoked_by, revoked_at FROM teacher_academic_habilitations WHERE id = $1', [f.teacherPeriodId]);
    assert.equal(rows[0].revoked_by, f.admin.id);
    assert.ok(rows[0].revoked_at);
  } finally {
    if (transaction) await blocker.query('ROLLBACK').catch(() => {});
    await blocker.end();
  }
});
