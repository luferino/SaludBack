import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import config from '../../src/config.ts';
import { createTeacherRouter } from '../../src/modules/teachers/infrastructure/routes/teacher.routes.ts';
import { PgTeacherRepository } from '../../src/modules/teachers/infrastructure/repositories/pg-teacher.repository.ts';
import { PgUserRepository } from '../../src/modules/auth/infrastructure/repositories/pg-user.repository.ts';
import { BcryptHasher } from '../../src/modules/auth/infrastructure/services/bcrypt-hasher.service.ts';
import { PgUnitOfWork } from '../../src/modules/shared/infrastructure/pg-unit-of-work.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.ts';
import { AdminGuard } from '../../src/modules/shared/application/guard.ts';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { cleanDb } from './helpers/clean-db.js';
import { seedAdmin, tokenForRole } from './helpers/admin-token.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const CONTRACT_KEYS = ['id', 'nombres', 'apellidos', 'email', 'celular', 'created_by', 'created_at'];

const VALID_PAYLOAD = {
  username: 'teaalta1',
  password: 'secret12345',
  nombres: 'Maria',
  apellidos: 'Ruiz',
  email: 'teaalta1@example.com',
  celular: '+5491100000000',
};

/**
 * Production-like stack: authenticate (populates req.auth) then the router,
 * whose handler runs AdminGuard and resolves created_by from the token sub.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    '/teachers',
    authenticate(new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn })),
    createTeacherRouter({
      repository: new PgTeacherRepository(pool),
      userRepository: new PgUserRepository(pool),
      hasher: new BcryptHasher(config.bcryptCost),
      unitOfWork: new PgUnitOfWork(pool),
      guard: new AdminGuard(),
    }),
  );
  app.use(errorHandler);
  return app;
}

let server;
let baseUrl;
let adminId;
let adminToken;

before(async () => {
  // Own cleanup: teachers must be gone before users (FK teachers.user_id -> users.id).
  // Full FK-order hardening across files is PR 4; this keeps the shared test DB
  // clean so auth.test.js's `DELETE FROM users` never trips on leftover rows.
  await cleanDb(pool);
  ({ id: adminId, token: adminToken } = await seedAdmin(pool));
  server = buildApp().listen(0);
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

async function createTeacher(payload, options = {}) {
  const res = await fetch(`${baseUrl}/teachers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
      ...options.headers,
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function countUsers(username) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [
    username,
  ]);
  return rows[0].n;
}

test('POST /teachers rejects a missing, garbage and non-admin token (401/401/403)', async () => {
  const payload = { ...VALID_PAYLOAD, username: 'teaguard1', nombres: 'Nadia' };

  const noToken = await fetch(`${baseUrl}/teachers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(noToken.status, 401);

  const garbage = await fetch(`${baseUrl}/teachers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer not.a.jwt' },
    body: JSON.stringify(payload),
  });
  assert.equal(garbage.status, 401);

  const nonAdmin = await fetch(`${baseUrl}/teachers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await tokenForRole('estudiante')}`,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(nonAdmin.status, 403);
  assert.equal((await nonAdmin.json()).error.code, 'FORBIDDEN');

  assert.equal(await countUsers('TEAGUARD1'), 0, 'guard rejection persists nothing');
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM teachers WHERE nombres = $1',
    ['Nadia'],
  );
  assert.equal(rows[0].n, 0);
});

test('POST /teachers performs alta en uno: 201, exact 7-key contract, one teacher user, linked row (TEA-001 TEA-003)', async () => {
  const { status, body } = await createTeacher(VALID_PAYLOAD);

  assert.equal(status, 201);
  assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
  assert.equal(body.nombres, 'Maria');
  assert.equal(body.apellidos, 'Ruiz');
  assert.equal(body.email, 'teaalta1@example.com');
  assert.equal(body.celular, '+5491100000000');
  assert.equal(body.created_by, adminId, 'admin token sub lands in created_by (TEA-004 AUD-003)');
  assert.equal(typeof body.id, 'string');
  assert.equal(typeof body.created_at, 'string');
  // TEA-003: no internal fields leak, no codalumno key for teachers.
  assert.equal('user_id' in body, false);
  assert.equal('username' in body, false);
  assert.equal('password' in body, false);
  assert.equal('updated_by' in body, false);
  assert.equal('updated_at' in body, false);
  assert.equal('codalumno' in body, false);

  const { rows: users } = await pool.query(
    'SELECT id, role, password_hash, email FROM users WHERE username = $1',
    ['TEAALTA1'],
  );
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'teacher');
  assert.notEqual(users[0].password_hash, 'secret12345');
  assert.match(users[0].password_hash, /^\$2[aby]\$/);
  assert.equal(users[0].email, 'teaalta1@example.com');

  const { rows: teachers } = await pool.query(
    'SELECT user_id, email, created_by FROM teachers WHERE user_id = $1',
    [users[0].id],
  );
  assert.equal(teachers.length, 1);
  assert.equal(teachers[0].user_id, users[0].id, 'teacher row links to the new user (TEA-001)');
  assert.equal(teachers[0].email, 'teaalta1@example.com');
  assert.equal(teachers[0].created_by, adminId, 'created_by persisted from the admin token');
});

test('POST /teachers links to an existing username without a duplicate account or role change (TEA-002)', async () => {
  const { rows: [existing] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ('TEALINKUSER', 'keep-hash', 'estudiante', NULL) RETURNING id`,
  );

  const { status, body } = await createTeacher({
    username: 'tealinkuser',
    password: 'ignored-link123',
    nombres: 'Luis',
    apellidos: 'Perez',
  });

  assert.equal(status, 201);
  assert.equal(body.created_by, adminId, 'admin actor recorded on the link path');

  assert.equal(await countUsers('TEALINKUSER'), 1, 'no duplicate account');
  const { rows: users } = await pool.query(
    'SELECT role, password_hash FROM users WHERE id = $1',
    [existing.id],
  );
  assert.equal(users[0].role, 'estudiante', 'existing role unchanged (TEA-002)');
  assert.equal(users[0].password_hash, 'keep-hash', 'existing credentials unchanged (TEA-002)');

  const { rows: teachers } = await pool.query(
    'SELECT user_id, email FROM teachers WHERE user_id = $1',
    [existing.id],
  );
  assert.equal(teachers.length, 1);
  assert.equal(teachers[0].user_id, existing.id, 'links to the existing user');
  assert.equal(teachers[0].email, null, 'email-less payload -> NULL account email (UAC-002)');
});

test('POST /teachers links to an existing email even when the username is new (TEA-002)', async () => {
  const { rows: [existing] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ('TEAMAILUSER', 'keep-hash', 'teacher', 'teamail@example.com') RETURNING id`,
  );

  const { status } = await createTeacher({
    username: 'teabrandnew',
    password: 'secret12345',
    nombres: 'Ana',
    apellidos: 'Gomez',
    email: 'teamail@example.com',
  });

  assert.equal(status, 201);
  assert.equal(await countUsers('TEABRANDNEW'), 0, 'no account created for the new username');
  const { rows: byEmail } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE email = $1',
    ['teamail@example.com'],
  );
  assert.equal(byEmail[0].n, 1, 'no duplicate email account');

  const { rows: teachers } = await pool.query(
    'SELECT user_id FROM teachers WHERE user_id = $1',
    [existing.id],
  );
  assert.equal(teachers.length, 1);
  assert.equal(teachers[0].user_id, existing.id, 'links to the user that owns the email');
});

test('POST /teachers rejects missing required fields and bad email with 400 and persists nothing (TEA-001)', async () => {
  // Distinct nombres per payload keep the negative teachers check selective:
  // teachers have no codalumno to match on (unlike students).
  const badNombres = ['BadUn', 'BadDos', 'BadTres', 'BadCuatro', 'BadCinco', 'BadSeis'];
  const payloads = [
    { ...VALID_PAYLOAD, username: 'teabad1', nombres: badNombres[0], apellidos: undefined }, // missing apellidos (TEA-001 scenario)
    { password: 'secret12345', nombres: badNombres[1], apellidos: 'Lopez' }, // missing username
    { username: 'teabad3', nombres: badNombres[2], apellidos: 'Lopez' }, // missing password
    { username: 'teabad4', password: 'secret12345', nombres: badNombres[3] }, // missing apellidos
    { username: 'teabad5', password: 'secret12345', nombres: badNombres[4], apellidos: '' }, // blank apellidos
    { ...VALID_PAYLOAD, username: 'teabad6', nombres: badNombres[5], email: 'not-an-email' },
  ];

  for (const payload of payloads) {
    const { status, body } = await createTeacher(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }

  for (const username of ['TEABAD1', 'TEABAD2', 'TEABAD3', 'TEABAD4', 'TEABAD5', 'TEABAD6']) {
    assert.equal(await countUsers(username), 0, `${username} must not be persisted`);
  }
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM teachers WHERE nombres = ANY($1)',
    [badNombres],
  );
  assert.equal(rows[0].n, 0);
});