import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import config from '../../src/config.ts';
import { createApp } from '../../src/app.ts';
import { cleanDb } from './helpers/clean-db.js';
import { seedAdmin, tokenForRole, expiredTokenForRole } from './helpers/admin-token.js';

/**
 * End-to-end wiring coverage: the REAL app factory used by index.ts mounts
 * /auth, /patients, /students and /teachers together with the shared pool,
 * repositories and unit of work. Since the AdminGuard era, register and the
 * alta endpoints require a verified admin Bearer token (401 without one,
 * 403 for non-admin callers); these tests prove the wiring enforces that
 * and that authorized alta still persists linked rows.
 */
const pool = new pg.Pool({ connectionString: config.databaseUrl });

let server;
let baseUrl;
let adminToken;
let adminId;

async function post(path, body, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getMe(options = {}) {
  const res = await fetch(`${baseUrl}/auth/me`, options);
  return { status: res.status, body: await res.json() };
}

/** Default admin-authorized POST; override headers via options. */
async function postAsAdmin(path, body, options = {}) {
  return post(path, body, {
    ...options,
    headers: { authorization: `Bearer ${adminToken}`, ...options.headers },
  });
}

before(async () => {
  // FK-safe cleanup (shared DB; students/teachers/patients/tokens before users).
  await cleanDb(pool);
  ({ id: adminId, token: adminToken } = await seedAdmin(pool));

  const app = createApp(pool);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    await new Promise((resolve) => server.close(resolve));
  } finally {
    try {
      await cleanDb(pool);
    } finally {
      await pool.end();
    }
  }
});

test('GET / answers the heartbeat (index wiring boots the app)', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'Hello, World!');
});

test('the wiring mounts GET /auth/me behind authenticate + PermissionGuard (401/200, PR-001)', async () => {
  const noToken = await getMe();
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.error.code, 'UNAUTHORIZED');
  assert.equal(noToken.body.error.message, 'Invalid or missing token');

  const expired = await getMe({
    headers: { authorization: `Bearer ${await expiredTokenForRole('admin')}` },
  });
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'UNAUTHORIZED');

  const me = await getMe({ headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { username: 'ADMINBOOT', email: null, role: 'admin' });
  assert.deepEqual(Object.keys(me.body).sort(), ['email', 'role', 'username']);
  assert.equal(me.body.passwordHash, undefined);
  assert.equal('sub' in me.body, false);
  assert.equal('permissions' in me.body, false);
});

test('the wiring mounts authenticate + AdminGuard on POST /auth/register (401/403/201)', async () => {
  const payload = {
    username: 'wiringauth1',
    password: 'secret12345',
    email: 'wiringauth1@example.com',
  };

  const noToken = await post('/auth/register', payload);
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.error.code, 'UNAUTHORIZED');

  const nonAdmin = await post('/auth/register', payload, {
    headers: { authorization: `Bearer ${await tokenForRole('estudiante')}` },
  });
  assert.equal(nonAdmin.status, 403);
  assert.equal(nonAdmin.body.error.code, 'FORBIDDEN');

  const { status, body } = await postAsAdmin('/auth/register', payload);
  assert.equal(status, 201);
  assert.equal(body.role, 'estudiante');
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [
    'WIRINGAUTH1',
  ]);
  assert.equal(rows[0].n, 1);
  const { rows: actorRows } = await pool.query('SELECT created_by FROM users WHERE username = $1', [
    'WIRINGAUTH1',
  ]);
  assert.equal(actorRows[0].created_by, adminId, 'register stamps created_by from the admin token sub (AUD-003)');
});

test('the wiring mounts authenticate + AdminGuard on POST /students (401/403/201)', async () => {
  const payload = {
    username: 'wiringstu1',
    password: 'secret12345',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: 'WIRING001',
    email: 'wiringstu1@example.com',
    celular: '+5491100000000',
  };

  const noToken = await post('/students', payload);
  assert.equal(noToken.status, 401);

  const nonAdmin = await post('/students', payload, {
    headers: { authorization: `Bearer ${await tokenForRole('teacher')}` },
  });
  assert.equal(nonAdmin.status, 403);
  assert.equal(nonAdmin.body.error.code, 'FORBIDDEN');

  const { status, body } = await postAsAdmin('/students', payload);
  assert.equal(status, 201);
  assert.equal(body.codalumno, 'WIRING001');
  assert.equal(body.created_by, adminId, 'admin token sub lands in created_by');

  const { rows: users } = await pool.query(
    'SELECT id, role, created_by FROM users WHERE username = $1',
    ['WIRINGSTU1'],
  );
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'estudiante');
  assert.equal(
    users[0].created_by,
    adminId,
    'alta stamps users.created_by from the admin token sub (AUD-003)',
  );
  const { rows: students } = await pool.query('SELECT user_id FROM students WHERE codalumno = $1', [
    'WIRING001',
  ]);
  assert.equal(students.length, 1);
  assert.equal(students[0].user_id, users[0].id);
});

test('the wiring mounts authenticate + AdminGuard on POST /teachers (401/403/201)', async () => {
  const payload = {
    username: 'wiringtea1',
    password: 'secret12345',
    nombres: 'Maria',
    apellidos: 'Ruiz',
    email: 'wiringtea1@example.com',
    celular: '+5491100000000',
  };

  const noToken = await post('/teachers', payload);
  assert.equal(noToken.status, 401);

  const nonAdmin = await post('/teachers', payload, {
    headers: { authorization: `Bearer ${await tokenForRole('estudiante')}` },
  });
  assert.equal(nonAdmin.status, 403);

  const { status, body } = await postAsAdmin('/teachers', payload);
  assert.equal(status, 201);
  assert.equal(body.nombres, 'Maria');
  assert.equal(body.apellidos, 'Ruiz');
  assert.equal(body.created_by, adminId);

  const { rows: users } = await pool.query(
    'SELECT id, role, created_by FROM users WHERE username = $1',
    ['WIRINGTEA1'],
  );
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'teacher');
  assert.equal(
    users[0].created_by,
    adminId,
    'alta stamps users.created_by from the admin token sub (AUD-003)',
  );
  const { rows: teachers } = await pool.query('SELECT user_id FROM teachers WHERE user_id = $1', [
    users[0].id,
  ]);
  assert.equal(teachers.length, 1);
});

test('the wiring mounts authenticate + AdminGuard on POST /patients (401/403/201)', async () => {
  const payload = {
    documento: '99999999',
    nombres: 'Ana',
    apellidos: 'Lopez',
    fecha_nacimiento: '1990-04-12',
    email: 'wiring-pat@example.com',
    celular: '+5491100000000',
    sexo: 'F',
    direccion: 'Av. Siempre Viva 742',
  };

  const noToken = await post('/patients', payload);
  assert.equal(noToken.status, 401);

  const nonAdmin = await post('/patients', payload, {
    headers: { authorization: `Bearer ${await tokenForRole('teacher')}` },
  });
  assert.equal(nonAdmin.status, 403);
  assert.equal(nonAdmin.body.error.code, 'FORBIDDEN');

  const { status, body } = await postAsAdmin('/patients', payload);
  assert.equal(status, 201);
  assert.equal(body.documento, '99999999');
  assert.equal(body.created_by, adminId);
});

test('login and password recovery stay public behind the /auth mount', async () => {
  const login = await post('/auth/login', { username: 'ghost', password: 'whatever' });
  assert.equal(login.status, 401, 'login is reachable (invalid creds, not blocked by auth middleware)');
  assert.equal(login.body.error.code, 'UNAUTHORIZED');
  assert.equal(
    login.body.error.message,
    'Invalid credentials',
    'the 401 comes from the login use case, not from authenticate middleware mis-wired onto login',
  );

  const forgot = await post('/auth/forgot-password', { username: 'ghost' });
  assert.equal(forgot.status, 200, 'forgot-password remains unauthenticated');
});

test('an expired token is rejected with 401 on the real protected wiring (POST /auth/register)', async () => {
  const res = await post(
    '/auth/register',
    {
      username: 'expiredreg',
      password: 'secret12345',
      email: 'expiredreg@example.com',
    },
    { headers: { authorization: `Bearer ${await expiredTokenForRole('admin')}` } },
  );
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(
    res.body.error.message,
    'Invalid or missing token',
    'an expired token is rejected BY authenticate (token verification), not by a missing auth context',
  );

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username = $1',
    ['EXPIREDREG'],
  );
  assert.equal(rows[0].n, 0, 'the register handler never ran for an expired token');
});

test('an expired token is rejected with 401 on a real alta endpoint (POST /students)', async () => {
  const res = await post(
    '/students',
    {
      username: 'expiredstu',
      password: 'secret12345',
      nombres: 'Ana',
      apellidos: 'Lopez',
      codalumno: 'WIRINGEXP',
    },
    { headers: { authorization: `Bearer ${await expiredTokenForRole('admin')}` } },
  );
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(
    res.body.error.message,
    'Invalid or missing token',
    'an expired token is rejected BY authenticate (token verification), not by a missing auth context',
  );

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM students WHERE codalumno = $1',
    ['WIRINGEXP'],
  );
  assert.equal(rows[0].n, 0, 'the students handler never ran for an expired token');
});