import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Destructive fixture: the explicit opt-in, private configuration, target
// identity, schema, migration ledger, and complete grant matrix are checked
// before cleanDb can delete rows or rebuild permissions. Never load .env.
const ENV_PREFIX = 'SUBJECT_GROUPS_TEST_';
const REQUIRED_ENV = [
  'DATABASE_URL', 'EXPECTED_DATABASE', 'EXPECTED_SCHEMA', 'EXPECTED_TARGET_FINGERPRINT', 'JWT_SECRET',
  'CLIENT_URL', 'JWT_SECRET_KID', 'JWT_EXPIRES_IN', 'BCRYPT_COST',
  'RESET_TOKEN_TTL', 'RESET_TOKEN_MAX_OUTSTANDING',
].map((name) => `${ENV_PREFIX}${name}`);
const ISOLATION_FLAG = `${ENV_PREFIX}ISOLATED`;
const STARTUP_SEARCH_PATH = 'pg_catalog,public,pg_temp';
const PG_OPTIONS = `-c search_path=${STARTUP_SEARCH_PATH} -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000`;
const MIGRATIONS = [
  '001_create_users.sql', '002_create_patients.sql', '003_add_email_and_reset_tokens.sql',
  '004_multi_role_and_audit.sql', '005_user_id_unique_profiles.sql',
  '006_create_permission_matrix.sql', '007_seed_permission_matrix.sql',
  '008_create_clinical_records.sql', '009_create_academic_contexts.sql',
  '010_create_academic_habilitations.sql', '011_seed_subject_permissions.sql',
  '012_seed_group_permissions.sql', '013_seed_subject_group_permissions.sql',
  '014_seed_teacher_habilitation_permissions.sql', '015_seed_teacher_habilitation_revocation_permission.sql', '016_seed_student_habilitation_permissions.sql', '017_create_patient_assignments.sql', '018_seed_patient_assignment_permissions.sql', '019_seed_student_habilitation_revocation_permission.sql',
  '020_create_kinesiology_evaluations.sql', '021_seed_kinesiology_evaluation_permissions.sql',
];
const EXPECTED_PERMISSIONS = new Set([
  'users:write', 'students:write', 'teachers:write', 'patients:write', 'profile:read',
  'materias:read', 'turnos:read', 'subjects:write', 'subjects:read',
  'groups:write', 'groups:read', 'subject-groups:write', 'subject-groups:read',
  'teacher-habilitations:write', 'teacher-habilitations:revoke', 'student-habilitations:write',
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
const CLEANUP_TABLES = [
  'kinesiology_evaluations', 'patient_assignments', 'student_academic_habilitations', 'teacher_academic_habilitations', 'students', 'teachers',
  'subject_academic_groups', 'academic_groups', 'subjects', 'clinical_records', 'patients',
  'password_reset_tokens', 'users',
];
const REQUIRED_TABLES = [...CLEANUP_TABLES, 'permissions', 'role_permissions', 'schema_migrations'];
const ADMIN_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ACTOR_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const SUBJECT_IDS = [
  'a0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
];
const GROUP_IDS = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
];

let pool;
let connectionSettings;
let server;
let baseUrl;
let config;
let createApp;
let cleanDb;
let cleanupAuthorized = false;
let JwtTokenService;

function privateConnectionSettings() {
  const raw = process.env[`${ENV_PREFIX}DATABASE_URL`];
  assert.match(raw, /^postgres(?:ql)?:\/\/[^/?#]+\/[^/?#]+$/i,
    `${ENV_PREFIX}DATABASE_URL must be a plain single-host URL without query options or fragments.`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${ENV_PREFIX}DATABASE_URL must be one unambiguous PostgreSQL URL.`); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Only PostgreSQL URLs are accepted.');
  const host = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  assert.ok(host && !host.includes(',') && !host.includes('%'), 'Exactly one unambiguous database host is required.');
  assert.ok(url.port && /^\d+$/.test(url.port) && Number(url.port) <= 65535 && Number(url.port) > 0,
    'An explicit single TCP port from 1 through 65535 is required.');
  assert.ok(url.username && url.password, 'A nonblank database username and password are required.');
  assert.ok(url.pathname.length > 1 && !url.pathname.slice(1).includes('/'), 'Exactly one database name is required.');
  assert.equal(url.search, '', 'Database URL query options are not accepted; supply a plain single-host URL.');
  assert.equal(url.hash, '', 'Database URL fragments are not accepted.');
  const database = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  assert.ok(database && !database.includes('/') && !database.includes('\0') && user && password,
    'Database name, user, and password must be unambiguous and nonblank.');
  return { host, port: Number(url.port), database, user, password };
}

function assertPrivateConfiguration() {
  assert.equal(process.env[ISOLATION_FLAG], 'true',
    `Set ${ISOLATION_FLAG}=true only after confirming the target is a dedicated disposable integration database.`);
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  assert.deepEqual(missing, [], `Supply all dedicated ${ENV_PREFIX} configuration explicitly.`);
  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'EXPECTED_DATABASE', 'EXPECTED_SCHEMA', 'EXPECTED_TARGET_FINGERPRINT']) {
    assert.doesNotMatch(process.env[`${ENV_PREFIX}${name}`], /^\s*$/, `${ENV_PREFIX}${name} must be nonblank.`);
  }
  assert.equal(process.env[`${ENV_PREFIX}EXPECTED_SCHEMA`], 'public', 'Only the public application schema is supported.');
}

async function verifyDestructivePreflight() {
  const { rows: identityRows } = await pool.query(
    `SELECT current_database() AS database_name, current_schema() AS schema_name,
            (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_oid,
            (SELECT oid::text FROM pg_catalog.pg_namespace WHERE nspname = 'public') AS public_oid,
            inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
            current_setting('server_version') AS server_version,
            current_schemas(true)::text[] AS effective_schemas,
            current_setting('search_path') AS search_path,
            current_setting('statement_timeout') AS statement_timeout,
            current_setting('lock_timeout') AS lock_timeout,
            current_setting('idle_in_transaction_session_timeout') AS idle_timeout`,
  );
  assert.equal(identityRows.length, 1);
  const identity = identityRows[0];
  assert.equal(identity.database_name, process.env[`${ENV_PREFIX}EXPECTED_DATABASE`]);
  assert.equal(identity.database_name, connectionSettings.database, 'Connected database does not match the URL database component.');
  assert.equal(identity.schema_name, 'pg_catalog');
  assert.deepEqual(identity.effective_schemas, ['pg_catalog', 'public']);
  assert.equal(identity.search_path, STARTUP_SEARCH_PATH);
  assert.deepEqual([identity.statement_timeout, identity.lock_timeout, identity.idle_timeout], ['5s', '5s', '5s']);
  assert.ok(identity.database_oid && identity.public_oid && identity.server_address && identity.server_port,
    'Server must provide complete non-local target identity components.');
  const fingerprintInput = JSON.stringify({
    host: connectionSettings.host, port: connectionSettings.port, database: identity.database_name,
    database_oid: identity.database_oid, public_oid: identity.public_oid,
    server_address: identity.server_address, server_port: identity.server_port,
    server_version: identity.server_version,
  });
  const fingerprint = createHash('sha256').update(fingerprintInput, 'utf8').digest('hex');
  assert.match(process.env[`${ENV_PREFIX}EXPECTED_TARGET_FINGERPRINT`], /^[a-f0-9]{64}$/,
    'Expected target fingerprint must be a lowercase SHA-256 hex digest.');
  assert.equal(fingerprint, process.env[`${ENV_PREFIX}EXPECTED_TARGET_FINGERPRINT`],
    'Connected server fingerprint does not match the privately supplied exact target binding.');
  const resolved = await pool.query(
    `SELECT requested.relname, public_relation.oid::text AS public_oid, resolved.oid::text AS resolved_oid
       FROM unnest($1::text[]) AS requested(relname)
       LEFT JOIN pg_catalog.pg_class public_relation ON public_relation.relnamespace = 'public'::regnamespace AND public_relation.relname = requested.relname
       LEFT JOIN LATERAL (SELECT pg_catalog.to_regclass(requested.relname)::oid AS oid) resolved ON true
       ORDER BY requested.relname`, [REQUIRED_TABLES],
  );
  assert.equal(resolved.rows.length, REQUIRED_TABLES.length);
  assert.ok(resolved.rows.every((row) => row.public_oid && row.public_oid === row.resolved_oid),
    'Effective relation resolution is missing or shadowed; refusing destructive fixture setup.');

  const { rows: tableRows } = await pool.query(
    'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[]) ORDER BY tablename',
    ['public', REQUIRED_TABLES],
  );
  assert.deepEqual(tableRows.map(({ tablename }) => tablename), [...REQUIRED_TABLES].sort(),
    'Required application and permission schema is incomplete.');

  const { rows: constraints } = await pool.query(
    `SELECT c.conname AS name, c.contype AS type, c.convalidated AS validated,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
            c.condeferrable AS deferrable, c.condeferred AS initially_deferred,
            c.confdeltype AS delete_action, c.confupdtype AS update_action, c.confmatchtype AS match_type,
            CASE WHEN c.confrelid = 0 THEN NULL ELSE c.confrelid::regclass::text END AS referenced_table,
            ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS referenced_columns
       FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      WHERE t.relnamespace = 'public'::regnamespace
        AND ((t.relname = 'academic_groups' AND c.conname = 'academic_groups_year_semester_name_unique')
          OR (t.relname = 'subject_academic_groups' AND c.conname IN (
            'subject_academic_groups_pkey', 'subject_academic_groups_subject_id_fkey',
            'subject_academic_groups_academic_group_id_fkey')))
      ORDER BY c.conname`,
  );
  assert.deepEqual(constraints, [
    { name: 'academic_groups_year_semester_name_unique', type: 'u', validated: true,
      deferrable: false, initially_deferred: false, delete_action: ' ', update_action: ' ', match_type: ' ',
      columns: ['academic_year', 'curriculum_semester', 'name'], referenced_table: null, referenced_columns: [] },
    { name: 'subject_academic_groups_academic_group_id_fkey', type: 'f', validated: true,
      deferrable: false, initially_deferred: false, delete_action: 'a', update_action: 'a', match_type: 's',
      columns: ['academic_group_id'], referenced_table: 'academic_groups', referenced_columns: ['id'] },
    { name: 'subject_academic_groups_pkey', type: 'p', validated: true,
      deferrable: false, initially_deferred: false, delete_action: ' ', update_action: ' ', match_type: ' ',
      columns: ['subject_id', 'academic_group_id'], referenced_table: null, referenced_columns: [] },
    { name: 'subject_academic_groups_subject_id_fkey', type: 'f', validated: true,
      deferrable: false, initially_deferred: false, delete_action: 'a', update_action: 'a', match_type: 's',
      columns: ['subject_id'], referenced_table: 'subjects', referenced_columns: ['id'] },
  ], 'Catalog uniqueness/foreign-key structure does not match the fixture contract.');

  const { rows: ledger } = await pool.query('SELECT name FROM public.schema_migrations ORDER BY name');
  assert.deepEqual(ledger.map(({ name }) => name), MIGRATIONS,
    'Migrations 001–014 must already be applied exactly; this suite never migrates.');

  const { rows: permissions } = await pool.query('SELECT permission, enforced FROM permissions ORDER BY permission');
  assert.deepEqual(new Set(permissions.map(({ permission }) => permission)), EXPECTED_PERMISSIONS);
  assert.equal(permissions.length, 25, 'Expected the full 25-permission baseline before cleanup.');
  for (const permission of ['materias:read', 'turnos:read']) {
    assert.equal(permissions.find((row) => row.permission === permission).enforced, false,
      `${permission} is a legacy permission and must remain unenforced.`);
  }
  assert.ok(permissions.filter(({ permission }) => !['materias:read', 'turnos:read'].includes(permission))
    .every(({ enforced }) => enforced === true), 'Every other canonical permission must be enforced.');
  const { rows: grants } = await pool.query('SELECT role, permission FROM role_permissions ORDER BY role, permission');
  assert.deepEqual(new Set(grants.map(({ role, permission }) => `${role}:${permission}`)), EXPECTED_GRANTS);
  assert.equal(grants.length, 32, 'Expected the full 32-grant baseline before cleanup.');

  const checks = [
    ...CLEANUP_TABLES.map((table_name) => ({ table_name, privilege: 'DELETE' })),
    { table_name: 'role_permissions', privilege: 'DELETE' },
    ...REQUIRED_TABLES.map((table_name) => ({ table_name, privilege: 'SELECT' })),
    ...['users', 'subjects', 'academic_groups', 'subject_academic_groups', 'role_permissions', 'permissions'].map((table_name) => ({ table_name, privilege: 'INSERT' })),
    ...['role_permissions', 'permissions'].map((table_name) => ({ table_name, privilege: 'TRUNCATE' })),
  ];
  const { rows: privilegeRows } = await pool.query(
    `SELECT requested.table_name, requested.privilege,
            has_table_privilege(current_user, 'public.' || requested.table_name, requested.privilege) AS allowed
       FROM unnest($1::text[], $2::text[]) AS requested(table_name, privilege)
      ORDER BY requested.table_name, requested.privilege`,
    [checks.map(({ table_name }) => table_name), checks.map(({ privilege }) => privilege)],
  );
  assert.deepEqual(privilegeRows.filter(({ allowed }) => !allowed), [],
    'Database role lacks privileges required by the cleanup or endpoint fixture.');
  const schemaPrivilege = await pool.query("SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS allowed");
  assert.equal(schemaPrivilege.rows[0].allowed, true, 'Database role lacks public schema USAGE.');
  const sequences = await pool.query(
    `SELECT sequence.relname, has_sequence_privilege(current_user, sequence.oid, 'USAGE') AS allowed
       FROM pg_catalog.pg_class sequence
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace
       JOIN pg_catalog.pg_depend dependency ON dependency.classid = 'pg_catalog.pg_class'::regclass
         AND dependency.objid = sequence.oid AND dependency.refclassid = 'pg_catalog.pg_class'::regclass
         AND dependency.deptype IN ('a', 'i')
       JOIN pg_catalog.pg_class owner_table ON owner_table.oid = dependency.refobjid
      WHERE namespace.nspname = 'public' AND sequence.relkind = 'S'
        AND owner_table.relnamespace = 'public'::regnamespace AND owner_table.relname = ANY($1::text[])
      ORDER BY sequence.relname`,
    [['users', 'subjects', 'academic_groups', 'subject_academic_groups', 'role_permissions', 'permissions']],
  );
  assert.deepEqual(sequences.rows.filter(({ allowed }) => !allowed), [],
    'Database role lacks USAGE on a required public sequence.');
}

function tokenService() {
  return new JwtTokenService({
    secret: config.jwtSecret,
    secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets,
    expiresIn: config.jwtExpiresIn,
  });
}

async function signedToken({ role, sub, permissions = [] }) {
  const claims = { role, username: `${role}_subject_groups_test`, permissions };
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
  assertPrivateConfiguration();
  connectionSettings = privateConnectionSettings();
  for (const name of Object.keys(process.env)) {
    const normalizedName = name.toUpperCase();
    if (normalizedName.startsWith('PG') || normalizedName === 'NODE_PG_FORCE_NATIVE') delete process.env[name];
  }
  process.env.PGOPTIONS = PG_OPTIONS;
  process.env.DATABASE_URL = process.env[`${ENV_PREFIX}DATABASE_URL`];
  process.env.JWT_SECRET = process.env[`${ENV_PREFIX}JWT_SECRET`];
  process.env.CLIENT_URL = process.env[`${ENV_PREFIX}CLIENT_URL`];
  process.env.JWT_SECRET_KID = process.env[`${ENV_PREFIX}JWT_SECRET_KID`];
  process.env.JWT_EXPIRES_IN = process.env[`${ENV_PREFIX}JWT_EXPIRES_IN`];
  process.env.JWT_PREVIOUS_SECRETS = '[]';
  process.env.BCRYPT_COST = process.env[`${ENV_PREFIX}BCRYPT_COST`];
  process.env.RESET_TOKEN_TTL = process.env[`${ENV_PREFIX}RESET_TOKEN_TTL`];
  process.env.RESET_TOKEN_MAX_OUTSTANDING = process.env[`${ENV_PREFIX}RESET_TOKEN_MAX_OUTSTANDING`];
  process.env.PORT = '0';

  const { default: pg } = await import('pg');
  ({ default: config } = await import('../../src/config.ts'));
  ({ createApp } = await import('../../src/app.ts'));
  ({ cleanDb } = await import('./helpers/clean-db.js'));
  ({ JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
  pool = new pg.Pool({
    ...connectionSettings,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 5000,
    options: PG_OPTIONS,
  });
  await verifyDestructivePreflight();
  cleanupAuthorized = true;
  // cleanDb issues 17 non-transactional query calls containing 22 SQL statements:
  // 11 ordered DELETEs, one TRUNCATE, and ten INSERTs across five seed batches.
  // Its destructive scope is not atomic; failed preflight never reaches cleanup.
  await cleanDb(pool);
  await seedUser(ADMIN_ID, 'SUBJECT_GROUPS_ADMIN', 'admin');
  await seedUser(ACTOR_ID, 'SUBJECT_GROUPS_ACTOR', 'estudiante');
  for (let index = 0; index < SUBJECT_IDS.length; index += 1) {
    await pool.query('INSERT INTO subjects (id, name, created_by) VALUES ($1, $2, $3)', [
      SUBJECT_IDS[index], `Fixture subject ${index}`, ADMIN_ID,
    ]);
    await pool.query(
      'INSERT INTO academic_groups (id, academic_year, curriculum_semester, name, created_by) VALUES ($1, $2, $3, $4, $5)',
      [GROUP_IDS[index], 2060 + index, 1, `Fixture group ${index}`, ADMIN_ID],
    );
  }
  const app = createApp(pool);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  const errors = [];
  if (server) {
    try {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } catch (error) { errors.push(error); }
  }
  if (pool && cleanupAuthorized) {
    try { await cleanDb(pool); } catch (error) { errors.push(error); }
  }
  if (pool) {
    try { await pool.end(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Subject-group integration cleanup failed.');
});

test('GET lists persisted associations in stable subject/group order with explicit serialization and pagination', async () => {
  const links = [
    [SUBJECT_IDS[1], GROUP_IDS[2]],
    [SUBJECT_IDS[0], GROUP_IDS[1]],
    [SUBJECT_IDS[0], GROUP_IDS[0]],
  ];
  for (const [subjectId, groupId] of links) {
    await pool.query(
      'INSERT INTO subject_academic_groups (subject_id, academic_group_id, created_by) VALUES ($1, $2, $3)',
      [subjectId, groupId, ADMIN_ID],
    );
  }
  const token = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subject-groups:read'] });
  const all = await request('GET', '/subject-groups', { token });
  assert.equal(all.status, 200);
  assert.equal(all.body.limit, 50);
  assert.equal(all.body.offset, 0);
  assert.deepEqual(all.body.items.map(({ subject_id, academic_group_id }) => [subject_id, academic_group_id]), [
    [SUBJECT_IDS[1], GROUP_IDS[2]], [SUBJECT_IDS[0], GROUP_IDS[0]], [SUBJECT_IDS[0], GROUP_IDS[1]],
  ]);
  for (const item of all.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ['academic_group_id', 'created_at', 'created_by', 'subject_id']);
    assert.equal(item.created_by, ADMIN_ID);
    assert.ok(Number.isFinite(Date.parse(item.created_at)));
    assert.equal(new Date(item.created_at).toISOString(), item.created_at);
  }
  const page = await request('GET', '/subject-groups?limit=1&offset=1', { token });
  assert.deepEqual(page.body, { items: [all.body.items[1]], limit: 1, offset: 1 });
  assert.deepEqual((await request('GET', '/subject-groups?limit=100&offset=10000', { token })).body,
    { items: [], limit: 100, offset: 10000 });
  assert.deepEqual((await request('GET', `/subject-groups?offset=${all.body.items.length}`, { token })).body,
    { items: [], limit: 50, offset: all.body.items.length });

  const filtered = await request('GET', `/subject-groups?subject_id=${SUBJECT_IDS[0].toUpperCase()}`, { token });
  assert.deepEqual(filtered.body.items.map(({ academic_group_id }) => academic_group_id), [GROUP_IDS[0], GROUP_IDS[1]]);
  const noLinks = await request('GET', '/subject-groups?subject_id=30000000-0000-4000-8000-000000000099', { token });
  assert.deepEqual(noLinks.body, { items: [], limit: 50, offset: 0 });
});

test('POST persists the actor, ignores client attribution, and reports duplicate and missing catalog references', async () => {
  const token = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subject-groups:write'] });
  const body = {
    subject_id: SUBJECT_IDS[2],
    academic_group_id: GROUP_IDS[2],
    created_by: ACTOR_ID,
    actor: ACTOR_ID,
  };
  const created = await request('POST', '/subject-groups', { token, body });
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), ['academic_group_id', 'created_at', 'created_by', 'subject_id']);
  assert.equal(created.body.subject_id, SUBJECT_IDS[2]);
  assert.equal(created.body.academic_group_id, GROUP_IDS[2]);
  assert.equal(created.body.created_by, ADMIN_ID);
  assert.ok(Number.isFinite(Date.parse(created.body.created_at)));
  assert.equal(new Date(created.body.created_at).toISOString(), created.body.created_at);
  const duplicate = await request('POST', '/subject-groups', { token, body: {
    subject_id: SUBJECT_IDS[2], academic_group_id: GROUP_IDS[2],
  } });
  assert.equal(duplicate.status, 409);
  const { rows } = await pool.query(
    'SELECT subject_id, academic_group_id, created_by FROM subject_academic_groups WHERE subject_id = $1 AND academic_group_id = $2',
    [SUBJECT_IDS[2], GROUP_IDS[2]],
  );
  assert.deepEqual(rows, [{ subject_id: SUBJECT_IDS[2], academic_group_id: GROUP_IDS[2], created_by: ADMIN_ID }]);

  const nullableActor = await signedToken({ role: 'admin', permissions: ['subject-groups:write'] });
  const nullable = await request('POST', '/subject-groups', {
    token: nullableActor,
    body: { subject_id: SUBJECT_IDS[1], academic_group_id: GROUP_IDS[0], created_by: ADMIN_ID },
  });
  assert.equal(nullable.status, 201);
  assert.equal(nullable.body.created_by, null);
  assert.deepEqual((await pool.query(
    'SELECT created_by FROM subject_academic_groups WHERE subject_id = $1 AND academic_group_id = $2',
    [SUBJECT_IDS[1], GROUP_IDS[0]],
  )).rows, [{ created_by: null }]);

  const count = async () => Number((await pool.query('SELECT count(*)::int AS count FROM subject_academic_groups')).rows[0].count);
  const beforeMissing = await count();
  const missingSubject = await request('POST', '/subject-groups', { token, body: {
    subject_id: '30000000-0000-4000-8000-000000000001', academic_group_id: GROUP_IDS[0],
  } });
  const missingGroup = await request('POST', '/subject-groups', { token, body: {
    subject_id: SUBJECT_IDS[0], academic_group_id: '30000000-0000-4000-8000-000000000002',
  } });
  assert.equal(missingSubject.status, 404);
  assert.equal(missingGroup.status, 404);
  assert.equal(await count(), beforeMissing);
});

test('malformed UUIDs and query inputs are rejected before persistence; auth failures do not write', async () => {
  const write = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subject-groups:write'] });
  const read = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subject-groups:read'] });
  const count = async () => Number((await pool.query('SELECT count(*)::int AS count FROM subject_academic_groups')).rows[0].count);
  const initial = await count();
  for (const candidate of [
    {}, { subject_id: 'not-a-uuid', academic_group_id: GROUP_IDS[0] },
    { subject_id: SUBJECT_IDS[0], academic_group_id: `${GROUP_IDS[0]} ` },
    { subject_id: [], academic_group_id: GROUP_IDS[0] },
    { subject_id: SUBJECT_IDS[0], academic_group_id: null },
  ]) {
    assert.equal((await request('POST', '/subject-groups', { token: write, body: candidate })).status, 400);
  }
  for (const query of [
    '?subject_id=', '?subject_id=invalid', `?subject_id=%20${SUBJECT_IDS[0]}`,
    `?subject_id=${SUBJECT_IDS[0]}&subject_id=${SUBJECT_IDS[1]}`,
    '?limit=', '?limit=0', '?limit=101', '?limit=1.5', '?limit=-1', '?limit=1e2',
    '?offset=-1', '?offset=10001', '?offset=1.2', '?offset=1&offset=2', '?limit=1&limit=2',
  ]) {
    assert.equal((await request('GET', `/subject-groups${query}`, { token: read })).status, 400, query);
  }
  assert.equal((await request('POST', '/subject-groups', { body: {} })).status, 401);
  assert.equal((await request('GET', '/subject-groups', { token: 'not-a-valid-jwt' })).status, 401);
  assert.equal((await request('POST', '/subject-groups', { token: 'not-a-valid-jwt', body: {} })).status, 401);
  assert.equal(await count(), initial);
});

test('read/write grants are independent, delegated from fresh database state, and revocable without admin bypass', async () => {
  const readerRole = 'subject_groups_reader';
  const writerRole = 'subject_groups_writer';
  const delegatedRole = 'subject_groups_delegate';
  let failure;
  try {
    await setRolePermissions(readerRole, ['subject-groups:read']);
    await setRolePermissions(writerRole, ['subject-groups:write']);
    await setRolePermissions(delegatedRole, ['subject-groups:read', 'subject-groups:write']);
    const delegatedId = 'c3d4e5f6-a7b8-49c0-8d1e-2f3a4b5c6d7e';
    await seedUser(delegatedId, 'SUBJECT_GROUPS_DELEGATE', delegatedRole);
    const reader = await signedToken({ role: readerRole, sub: ACTOR_ID, permissions: ['subject-groups:read', 'subject-groups:write'] });
    const writer = await signedToken({ role: writerRole, sub: ACTOR_ID, permissions: ['subject-groups:read', 'subject-groups:write'] });
    const delegated = await signedToken({ role: delegatedRole, sub: delegatedId, permissions: [] });
    assert.equal((await request('GET', '/subject-groups', { token: reader })).status, 200);
    assert.equal((await request('POST', '/subject-groups', { token: reader, body: { subject_id: SUBJECT_IDS[0], academic_group_id: GROUP_IDS[2] } })).status, 403);
    assert.equal((await request('POST', '/subject-groups', { token: writer, body: { subject_id: SUBJECT_IDS[0], academic_group_id: GROUP_IDS[2] } })).status, 201);
    assert.equal((await request('GET', '/subject-groups', { token: writer })).status, 403);
    assert.equal((await request('POST', '/subject-groups', { token: delegated, body: { subject_id: SUBJECT_IDS[1], academic_group_id: GROUP_IDS[1] } })).status, 201);
    const legacy = await signedToken({ role: 'subject_groups_legacy', sub: ACTOR_ID, permissions: ['materias:read'] });
    assert.equal((await request('GET', '/subject-groups', { token: legacy })).status, 403);

    const admin = await signedToken({ role: 'admin', sub: ADMIN_ID, permissions: ['subject-groups:read', 'subject-groups:write'] });
    await setRolePermissions('admin', []);
    assert.equal((await request('GET', '/subject-groups', { token: admin })).status, 403);
    assert.equal((await request('POST', '/subject-groups', { token: admin, body: { subject_id: SUBJECT_IDS[1], academic_group_id: GROUP_IDS[2] } })).status, 403);
    await setRolePermissions(delegatedRole, ['subject-groups:write']);
    assert.equal((await request('GET', '/subject-groups', { token: delegated })).status, 403);
    assert.equal((await request('POST', '/subject-groups', { token: delegated, body: { subject_id: SUBJECT_IDS[2], academic_group_id: GROUP_IDS[0] } })).status, 201);
    await setRolePermissions(delegatedRole, []);
    assert.equal((await request('POST', '/subject-groups', { token: delegated, body: { subject_id: SUBJECT_IDS[2], academic_group_id: GROUP_IDS[1] } })).status, 403);
  } catch (error) {
    failure = error;
  } finally {
    const restorationErrors = [];
    for (const [role, permissions] of [
      ['admin', ['users:write', 'students:write', 'teachers:write', 'patients:write', 'profile:read', 'materias:read', 'turnos:read', 'subjects:write', 'subjects:read', 'groups:write', 'groups:read', 'subject-groups:write', 'subject-groups:read']],
      [readerRole, []], [writerRole, []], [delegatedRole, []], ['subject_groups_legacy', []],
    ]) {
      try { await setRolePermissions(role, permissions); } catch (error) { restorationErrors.push(error); }
    }
    if (restorationErrors.length) throw new AggregateError(failure ? [failure, ...restorationErrors] : restorationErrors,
      'Role-permission restoration failed after the grant fixture.');
  }
  if (failure) throw failure;
});
