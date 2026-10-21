import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// This suite performs destructive cleanup against its configured database.
// It requires an explicit isolation opt-in and dedicated credentials; it never
// imports application configuration until those values are validated, so
// src/config.ts cannot fall back to loading a repository .env file.
const REQUIRED_SUBJECTS_TEST_ENV = [
  'SUBJECTS_TEST_DATABASE_URL',
  'SUBJECTS_TEST_JWT_SECRET',
  'SUBJECTS_TEST_CLIENT_URL',
  'SUBJECTS_TEST_JWT_SECRET_KID',
  'SUBJECTS_TEST_JWT_EXPIRES_IN',
  'SUBJECTS_TEST_BCRYPT_COST',
  'SUBJECTS_TEST_RESET_TOKEN_TTL',
  'SUBJECTS_TEST_RESET_TOKEN_MAX_OUTSTANDING',
];

function assertIsolatedConfiguration() {
  assert.equal(
    process.env.SUBJECTS_TEST_ISOLATED,
    'true',
    'Set SUBJECTS_TEST_ISOLATED=true only after confirming this is a dedicated disposable integration database.',
  );
  const missing = REQUIRED_SUBJECTS_TEST_ENV.filter((name) => !process.env[name]);
  assert.deepEqual(missing, [], 'Complete dedicated SUBJECTS_TEST_* configuration is required.');
  assert.doesNotMatch(process.env.SUBJECTS_TEST_JWT_SECRET, /^\s*$/, 'JWT secret must be nonblank.');
  assert.doesNotMatch(process.env.SUBJECTS_TEST_DATABASE_URL, /^\s*$/, 'Database URL must be nonblank.');
}

const ADMIN_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ACTOR_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const SUBJECT_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
];
const EXPECTED_PERMISSIONS = new Set([
  'users:write', 'students:write', 'teachers:write', 'patients:write', 'profile:read',
  'materias:read', 'turnos:read', 'subjects:write', 'subjects:read', 'groups:write', 'groups:read',
  'subject-groups:write', 'subject-groups:read', 'teacher-habilitations:write', 'teacher-habilitations:revoke', 'student-habilitations:write',
  'student-habilitations:revoke', 'patient-assignments:write', 'patient-assignments:read', 'patient-assignments:read-own',
  'kinesiology-evaluations:read', 'kinesiology-evaluations:write', 'kinesiology-evaluations:submit', 'kinesiology-evaluations:verify-consent', 'kinesiology-evaluations:review',
]);
const EXPECTED_GRANTS = new Set([
  'estudiante:profile:read', 'estudiante:materias:read', 'estudiante:turnos:read',
  'teacher:profile:read', 'teacher:materias:read', 'teacher:turnos:read',
  'admin:users:write', 'admin:students:write', 'admin:teachers:write',
  'admin:patients:write', 'admin:profile:read', 'admin:materias:read', 'admin:turnos:read',
  'admin:subjects:write', 'admin:subjects:read', 'admin:groups:write', 'admin:groups:read',
  'admin:subject-groups:write', 'admin:subject-groups:read', 'admin:teacher-habilitations:write', 'admin:teacher-habilitations:revoke', 'teacher:student-habilitations:write', 'teacher:student-habilitations:revoke',
  'teacher:patient-assignments:write', 'teacher:patient-assignments:read', 'estudiante:patient-assignments:read-own',
  'teacher:kinesiology-evaluations:read', 'estudiante:kinesiology-evaluations:read', 'estudiante:kinesiology-evaluations:write', 'estudiante:kinesiology-evaluations:submit', 'teacher:kinesiology-evaluations:verify-consent', 'teacher:kinesiology-evaluations:review',
]);

let pool;
let server;
let baseUrl;
let cleanUpAuthorized = false;
let config;
let createApp;
let cleanDb;
let JwtTokenService;

function tokenService() {
  return new JwtTokenService({
    secret: config.jwtSecret,
    secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets,
    expiresIn: config.jwtExpiresIn,
  });
}

async function signedToken({ role, sub, permissions = [] }) {
  const claims = { role, username: `${role}_subject_test`, permissions };
  if (sub !== undefined) claims.sub = sub;
  return tokenService().sign(claims);
}

async function request(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function seedUser(id, username, role) {
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [id, username, 'not-a-real-hash', role],
  );
}

async function setRolePermissions(role, permissions) {
  await pool.query('DELETE FROM role_permissions WHERE role = $1', [role]);
  for (const permission of permissions) {
    await pool.query('INSERT INTO role_permissions (role, permission) VALUES ($1, $2)', [role, permission]);
  }
}

before(async () => {
  assertIsolatedConfiguration();
  // Map only explicitly provided test settings. Populate every application
  // config value before dynamic imports, preventing src/config.ts .env fallback.
  process.env.DATABASE_URL = process.env.SUBJECTS_TEST_DATABASE_URL;
  process.env.JWT_SECRET = process.env.SUBJECTS_TEST_JWT_SECRET;
  process.env.CLIENT_URL = process.env.SUBJECTS_TEST_CLIENT_URL;
  process.env.JWT_SECRET_KID = process.env.SUBJECTS_TEST_JWT_SECRET_KID;
  process.env.JWT_EXPIRES_IN = process.env.SUBJECTS_TEST_JWT_EXPIRES_IN;
  process.env.JWT_PREVIOUS_SECRETS = '[]';
  process.env.BCRYPT_COST = process.env.SUBJECTS_TEST_BCRYPT_COST;
  process.env.RESET_TOKEN_TTL = process.env.SUBJECTS_TEST_RESET_TOKEN_TTL;
  process.env.RESET_TOKEN_MAX_OUTSTANDING = process.env.SUBJECTS_TEST_RESET_TOKEN_MAX_OUTSTANDING;
  process.env.PORT = '0';

  ({ default: config } = await import('../../src/config.ts'));
  ({ createApp } = await import('../../src/app.ts'));
  ({ cleanDb } = await import('./helpers/clean-db.js'));
  ({ JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
  pool = new pg.Pool({ connectionString: config.databaseUrl });
});

after(async () => {
  const teardownErrors = [];
  if (server) {
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    } catch (error) {
      teardownErrors.push(error);
    }
  }
  if (pool && cleanUpAuthorized) {
    try {
      // DESTRUCTIVE: cleanDb deletes application rows (including users and
      // subjects) and rebuilds the permission matrix. It runs only after the
      // test's migration-ledger baseline has been verified.
      await cleanDb(pool);
    } catch (error) {
      teardownErrors.push(error);
    }
  }
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      teardownErrors.push(error);
    }
  }
  if (teardownErrors.length) {
    throw new AggregateError(teardownErrors, 'Subjects integration resource teardown failed.');
  }
});

test('migrations 011–022 are present before cleanup and cleanup restores the canonical matrix', async () => {
  const { rows: ledgerBefore } = await pool.query(
    'SELECT name FROM schema_migrations ORDER BY name',
  );
  const ledgerNamesBefore = new Set(ledgerBefore.map(({ name }) => name));
  assert.ok(ledgerNamesBefore.has('011_seed_subject_permissions.sql'), 'migration 011 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('012_seed_group_permissions.sql'), 'migration 012 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('013_seed_subject_group_permissions.sql'), 'migration 013 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('014_seed_teacher_habilitation_permissions.sql'), 'migration 014 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('015_seed_teacher_habilitation_revocation_permission.sql'), 'migration 015 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('016_seed_student_habilitation_permissions.sql'), 'migration 016 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('017_create_patient_assignments.sql'), 'migration 017 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('018_seed_patient_assignment_permissions.sql'), 'migration 018 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('019_seed_student_habilitation_revocation_permission.sql'), 'migration 019 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('020_create_kinesiology_evaluations.sql'), 'migration 020 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('021_seed_kinesiology_evaluation_permissions.sql'), 'migration 021 must already be applied; this suite never migrates');
  assert.ok(ledgerNamesBefore.has('022_create_kinesiology_consent_attestations.sql'), 'migration 022 must already be applied; this suite never migrates');

  const { rows: subjectPermissions } = await pool.query(
    "SELECT permission, enforced FROM permissions WHERE permission LIKE 'subjects:%' ORDER BY permission",
  );
  assert.deepEqual(subjectPermissions, [
    { permission: 'subjects:read', enforced: true },
    { permission: 'subjects:write', enforced: true },
  ]);
  const { rows: subjectGrants } = await pool.query(
    "SELECT role, permission FROM role_permissions WHERE permission LIKE 'subjects:%' ORDER BY role, permission",
  );
  assert.deepEqual(subjectGrants, [
    { role: 'admin', permission: 'subjects:read' },
    { role: 'admin', permission: 'subjects:write' },
  ]);
  const { rows: groupPermissions } = await pool.query(
    "SELECT permission, enforced FROM permissions WHERE permission LIKE 'groups:%' ORDER BY permission",
  );
  assert.deepEqual(groupPermissions, [
    { permission: 'groups:read', enforced: true },
    { permission: 'groups:write', enforced: true },
  ]);
  const { rows: groupGrants } = await pool.query(
    "SELECT role, permission FROM role_permissions WHERE permission LIKE 'groups:%' ORDER BY role, permission",
  );
  assert.deepEqual(groupGrants, [
    { role: 'admin', permission: 'groups:read' },
    { role: 'admin', permission: 'groups:write' },
  ]);

  const { rows: subjectGroupPermissions } = await pool.query(
    "SELECT permission, enforced FROM permissions WHERE permission LIKE 'subject-groups:%' ORDER BY permission",
  );
  assert.deepEqual(subjectGroupPermissions, [
    { permission: 'subject-groups:read', enforced: true },
    { permission: 'subject-groups:write', enforced: true },
  ]);
  const { rows: subjectGroupGrants } = await pool.query(
    "SELECT role, permission FROM role_permissions WHERE permission LIKE 'subject-groups:%' ORDER BY role, permission",
  );
  assert.deepEqual(subjectGroupGrants, [
    { role: 'admin', permission: 'subject-groups:read' },
    { role: 'admin', permission: 'subject-groups:write' },
  ]);

  const { rows: studentHabilitationPermissions } = await pool.query(
    "SELECT permission, enforced FROM permissions WHERE permission LIKE 'student-habilitations:%' ORDER BY permission",
  );
  assert.deepEqual(studentHabilitationPermissions, [
    { permission: 'student-habilitations:revoke', enforced: true },
    { permission: 'student-habilitations:write', enforced: true },
  ]);
  const { rows: studentHabilitationGrants } = await pool.query(
    "SELECT role, permission FROM role_permissions WHERE permission LIKE 'student-habilitations:%' ORDER BY role, permission",
  );
  assert.deepEqual(studentHabilitationGrants, [
    { role: 'teacher', permission: 'student-habilitations:revoke' },
    { role: 'teacher', permission: 'student-habilitations:write' },
  ]);

  const { rows: teacherHabilitationPermissions } = await pool.query(
    "SELECT permission, enforced FROM permissions WHERE permission LIKE 'teacher-habilitations:%' ORDER BY permission",
  );
  assert.deepEqual(teacherHabilitationPermissions, [
    { permission: 'teacher-habilitations:revoke', enforced: true },
    { permission: 'teacher-habilitations:write', enforced: true },
  ]);
  const { rows: teacherHabilitationGrants } = await pool.query(
    "SELECT role, permission FROM role_permissions WHERE permission LIKE 'teacher-habilitations:%' ORDER BY role, permission",
  );
  assert.deepEqual(teacherHabilitationGrants, [
    { role: 'admin', permission: 'teacher-habilitations:revoke' },
    { role: 'admin', permission: 'teacher-habilitations:write' },
  ]);

  // Only the already-proven 011–022 baseline authorizes invoking broad cleanup.
  cleanUpAuthorized = true;
  await cleanDb(pool);
  const { rows: permissions } = await pool.query('SELECT permission FROM permissions ORDER BY permission');
  assert.deepEqual(new Set(permissions.map(({ permission }) => permission)), EXPECTED_PERMISSIONS);
  assert.equal(permissions.length, 25);
  const { rows: grants } = await pool.query('SELECT role, permission FROM role_permissions ORDER BY role, permission');
  assert.deepEqual(new Set(grants.map(({ role, permission }) => `${role}:${permission}`)), EXPECTED_GRANTS);
  assert.equal(grants.length, 32);
  const { rows: ledgerAfter } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  assert.deepEqual(new Set(ledgerAfter.map(({ name }) => name)), ledgerNamesBefore, 'cleanup must not change migration history');

  await seedUser(ADMIN_ID, 'SUBJECTS_ADMIN', 'admin');
  await seedUser(ACTOR_ID, 'SUBJECTS_ACTOR', 'estudiante');
  const app = createApp(pool);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test('POST trims names, allows duplicates, persists verified actor and returns only the public fields', async () => {
  const token = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subjects:write'] });
  const first = await request('POST', '/subjects', {
    token,
    body: { name: '  Biology  ', created_by: ACTOR_ID, actor: ACTOR_ID, updated_by: ACTOR_ID },
  });
  const second = await request('POST', '/subjects', { token, body: { name: 'Biology' } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.name, 'Biology');
  assert.notEqual(first.body.id, second.body.id);
  for (const result of [first.body, second.body]) {
    assert.deepEqual(Object.keys(result).sort(), ['created_at', 'created_by', 'id', 'name']);
    assert.match(result.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(result.created_by, ADMIN_ID);
    assert.ok(Number.isFinite(Date.parse(result.created_at)));
    assert.equal(new Date(result.created_at).toISOString(), result.created_at);
  }
  const { rows } = await pool.query('SELECT name, created_by FROM subjects WHERE id = $1', [first.body.id]);
  assert.deepEqual(rows, [{ name: 'Biology', created_by: ADMIN_ID }]);
});

test('a verified token without sub persists NULL attribution despite client actor fields', async () => {
  const token = await signedToken({ role: 'admin', permissions: ['subjects:write'] });
  const result = await request('POST', '/subjects', {
    token,
    body: { name: 'Nullable actor', created_by: ADMIN_ID, actor: ADMIN_ID },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.created_by, null);
  const { rows } = await pool.query('SELECT created_by FROM subjects WHERE id = $1', [result.body.id]);
  assert.deepEqual(rows, [{ created_by: null }]);
});

test('GET uses the default envelope, stable name/UUID ordering, bounded pagination, and no audit leakage', async () => {
  const token = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subjects:read'] });
  const seeds = [
    [SUBJECT_IDS[2], 'Alpha'],
    [SUBJECT_IDS[0], 'Alpha'],
    [SUBJECT_IDS[1], 'Beta'],
  ];
  for (const [id, name] of seeds) {
    await pool.query('INSERT INTO subjects (id, name, created_by) VALUES ($1, $2, $3)', [id, name, ADMIN_ID]);
  }
  const defaultPage = await request('GET', '/subjects', { token });
  assert.equal(defaultPage.status, 200);
  assert.equal(defaultPage.body.limit, 50);
  assert.equal(defaultPage.body.offset, 0);
  const seededOrder = [SUBJECT_IDS[0], SUBJECT_IDS[2], SUBJECT_IDS[1]];
  assert.deepEqual(defaultPage.body.items.slice(0, 3).map(({ id }) => id), seededOrder);
  for (const item of defaultPage.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ['created_at', 'created_by', 'id', 'name']);
  }
  const page = await request('GET', '/subjects?limit=1&offset=1', { token });
  assert.deepEqual(page.body, { items: [defaultPage.body.items[1]], limit: 1, offset: 1 });
  const maximum = await request('GET', '/subjects?limit=100&offset=10000', { token });
  assert.deepEqual(maximum.body, { items: [], limit: 100, offset: 10000 });
  const beyondOffset = defaultPage.body.items.length;
  const beyond = await request('GET', `/subjects?offset=${beyondOffset}`, { token });
  assert.deepEqual(beyond.body, { items: [], limit: 50, offset: beyondOffset });
});

test('malformed names and pagination, repeated query values, and invalid or missing tokens do not insert subjects', async () => {
  const writeToken = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subjects:write'] });
  const readToken = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subjects:read'] });
  const beforeCount = async () => Number((await pool.query('SELECT count(*)::int AS count FROM subjects')).rows[0].count);
  const initialCount = await beforeCount();
  for (const name of [null, '', '   ', 17, {}, []]) {
    const response = await request('POST', '/subjects', { token: writeToken, body: { name } });
    assert.equal(response.status, 400);
  }
  for (const query of [
    '?limit=', '?limit=0', '?limit=101', '?limit=1.5', '?limit=-1', '?limit=1e2',
    '?offset=-1', '?offset=10001', '?offset=1.2', '?offset=1&offset=2', '?limit=1&limit=2',
  ]) {
    const response = await request('GET', `/subjects${query}`, { token: readToken });
    assert.equal(response.status, 400, query);
  }
  assert.equal((await request('POST', '/subjects', { body: { name: 'No auth' } })).status, 401);
  assert.equal((await request('GET', '/subjects', { token: 'not-a-valid-jwt' })).status, 401);
  assert.equal((await request('POST', '/subjects', { token: 'not-a-valid-jwt', body: { name: 'No auth' } })).status, 401);
  assert.equal(await beforeCount(), initialCount);
});

test('read and write grants are independent, delegated grants work, legacy claims fail, admin claims cannot bypass DB, and revocation is immediate', async () => {
  const readerRole = 'subject_reader';
  const writerRole = 'subject_writer';
  const delegatedRole = 'subject_delegate';
  await setRolePermissions(readerRole, ['subjects:read']);
  await setRolePermissions(writerRole, ['subjects:write']);
  await setRolePermissions(delegatedRole, ['subjects:read', 'subjects:write']);
  const delegatedId = 'c3d4e5f6-a7b8-49c0-8d1e-2f3a4b5c6d7e';
  await seedUser(delegatedId, 'SUBJECTS_DELEGATE', delegatedRole);

  const reader = await signedToken({ role: readerRole, sub: ACTOR_ID, permissions: ['subjects:read', 'subjects:write'] });
  const writer = await signedToken({ role: writerRole, sub: ACTOR_ID, permissions: ['subjects:read', 'subjects:write'] });
  const delegated = await signedToken({ role: delegatedRole, sub: delegatedId, permissions: [] });
  assert.equal((await request('GET', '/subjects', { token: reader })).status, 200);
  assert.equal((await request('POST', '/subjects', { token: reader, body: { name: 'Reader denied write' } })).status, 403);
  assert.equal((await request('POST', '/subjects', { token: writer, body: { name: 'Writer allowed' } })).status, 201);
  assert.equal((await request('GET', '/subjects', { token: writer })).status, 403);
  assert.equal((await request('POST', '/subjects', { token: delegated, body: { name: 'Delegated' } })).status, 201);

  const legacyOnly = await signedToken({ role: 'legacy_subject_role', sub: ACTOR_ID, permissions: ['materias:read'] });
  assert.equal((await request('GET', '/subjects', { token: legacyOnly })).status, 403);

  const admin = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subjects:read', 'subjects:write'] });
  await setRolePermissions('admin', []);
  assert.equal((await request('GET', '/subjects', { token: admin })).status, 403);
  assert.equal((await request('POST', '/subjects', { token: admin, body: { name: 'Admin denied' } })).status, 403);

  await setRolePermissions(delegatedRole, ['subjects:write']);
  assert.equal((await request('POST', '/subjects', { token: delegated, body: { name: 'Before revoke' } })).status, 201);
  await setRolePermissions(delegatedRole, []);
  assert.equal((await request('POST', '/subjects', { token: delegated, body: { name: 'After revoke' } })).status, 403);
});
