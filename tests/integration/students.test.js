import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import config from '../../src/config.ts';
import { createStudentRouter } from '../../src/modules/students/infrastructure/routes/student.routes.ts';
import { PgStudentRepository } from '../../src/modules/students/infrastructure/repositories/pg-student.repository.ts';
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

const CONTRACT_KEYS = [
  'id',
  'nombres',
  'apellidos',
  'codalumno',
  'email',
  'celular',
  'created_by',
  'created_at',
];

const VALID_PAYLOAD = {
  username: 'stualta1',
  password: 'secret12345',
  nombres: 'Ana',
  apellidos: 'Lopez',
  codalumno: '20240123',
  email: 'stualta1@example.com',
  celular: '+5491100000000',
};

/**
 * Production-like stack: authenticate (populates req.auth) then the router,
 * whose handler runs AdminGuard and resolves created_by from the token sub.
 */
function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/students',
    authenticate(new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn })),
    createStudentRouter({
      repository: overrides.studentRepository ?? new PgStudentRepository(pool),
      userRepository: overrides.userRepository ?? new PgUserRepository(pool),
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
  // Own cleanup: students must be gone before users (FK students.user_id -> users.id).
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

async function createStudent(payload, options = {}) {
  const res = await fetch(`${baseUrl}/students`, {
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

/**
 * Wraps the real user repository so the pre-check lookups hit the DB
 * (returning null for fresh usernames/emails) but create() raises a raw
 * pg unique_violation (SQLSTATE 23505) — deterministically simulating the
 * TOCTOU race a duplicate can slip through. The endpoint must translate
 * it to 409, never leak it as a 500.
 */
function racingUserRepository(constraint, message) {
  const real = new PgUserRepository(pool);
  const leak = new Error(message);
  leak.code = '23505';
  leak.constraint = constraint;
  return {
    findByUsername: (username) => real.findByUsername(username),
    findByEmail: (email) => real.findByEmail(email),
    create: async () => {
      throw leak;
    },
  };
}

/**
 * Same idea for the student write: the codalumno pre-check hits the DB
 * (null for a fresh codalumno), but the students insert itself raises a
 * raw pg unique_violation on `students_codalumno_unique` (migration 004)
 * — deterministically simulating the TOCTOU race between the pre-check
 * and the write. The endpoint must translate it to 409, never leak it.
 */
function racingStudentRepository(constraint, message) {
  const real = new PgStudentRepository(pool);
  const leak = new Error(message);
  leak.code = '23505';
  leak.constraint = constraint;
  return {
    findByCodalumno: (codalumno) => real.findByCodalumno(codalumno),
    create: async () => {
      throw leak;
    },
  };
}

test('POST /students rejects a missing, garbage and non-admin token (401/401/403)', async () => {
  const payload = { ...VALID_PAYLOAD, username: 'stuguard1', codalumno: 'GUARD001' };

  const noToken = await fetch(`${baseUrl}/students`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(noToken.status, 401);

  const garbage = await fetch(`${baseUrl}/students`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer not.a.jwt' },
    body: JSON.stringify(payload),
  });
  assert.equal(garbage.status, 401);

  const nonAdmin = await fetch(`${baseUrl}/students`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await tokenForRole('teacher')}`,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(nonAdmin.status, 403);
  assert.equal((await nonAdmin.json()).error.code, 'FORBIDDEN');

  assert.equal(await countUsers('STUGUARD1'), 0, 'guard rejection persists nothing');
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM students WHERE codalumno = $1',
    ['GUARD001'],
  );
  assert.equal(rows[0].n, 0);
});

test('POST /students performs alta en uno: 201, exact 8-key contract, one estudiante user, linked row (STU-001 STU-004)', async () => {
  const { status, body } = await createStudent(VALID_PAYLOAD);

  assert.equal(status, 201);
  assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
  assert.equal(body.nombres, 'Ana');
  assert.equal(body.apellidos, 'Lopez');
  assert.equal(body.codalumno, '20240123');
  assert.equal(body.email, 'stualta1@example.com');
  assert.equal(body.celular, '+5491100000000');
  assert.equal(body.created_by, adminId, 'admin token sub lands in created_by (STU-005 AUD-003)');
  assert.equal(typeof body.id, 'string');
  assert.equal(typeof body.created_at, 'string');
  // STU-004: no internal fields leak.
  assert.equal('user_id' in body, false);
  assert.equal('username' in body, false);
  assert.equal('password' in body, false);
  assert.equal('updated_by' in body, false);
  assert.equal('updated_at' in body, false);

  const { rows: users } = await pool.query(
    'SELECT id, role, password_hash, email FROM users WHERE username = $1',
    ['STUALTA1'],
  );
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'estudiante');
  assert.notEqual(users[0].password_hash, 'secret12345');
  assert.match(users[0].password_hash, /^\$2[aby]\$/);
  assert.equal(users[0].email, 'stualta1@example.com');

  const { rows: students } = await pool.query(
    'SELECT user_id, codalumno, created_by FROM students WHERE codalumno = $1',
    ['20240123'],
  );
  assert.equal(students.length, 1);
  assert.equal(students[0].user_id, users[0].id, 'student row links to the new user (STU-001)');
  assert.equal(students[0].created_by, adminId, 'created_by persisted from the admin token');
});

test('POST /students links to an existing username without a duplicate account or role change (STU-002)', async () => {
  const { rows: [existing] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ('STULINKUSER', 'keep-hash', 'teacher', NULL) RETURNING id`,
  );

  const { status, body } = await createStudent({
    username: 'stulinkuser',
    password: 'ignored-link123',
    nombres: 'Luis',
    apellidos: 'Perez',
    codalumno: 'LINK001',
  });

  assert.equal(status, 201);
  assert.equal(body.created_by, adminId, 'admin actor recorded on the link path');

  assert.equal(await countUsers('STULINKUSER'), 1, 'no duplicate account');
  const { rows: users } = await pool.query(
    'SELECT role, password_hash FROM users WHERE id = $1',
    [existing.id],
  );
  assert.equal(users[0].role, 'teacher', 'existing role unchanged (STU-002)');
  assert.equal(users[0].password_hash, 'keep-hash', 'existing credentials unchanged (STU-002)');

  const { rows: students } = await pool.query(
    'SELECT user_id, email FROM students WHERE codalumno = $1',
    ['LINK001'],
  );
  assert.equal(students.length, 1);
  assert.equal(students[0].user_id, existing.id, 'links to the existing user');
  assert.equal(students[0].email, null, 'email-less payload -> NULL account email (UAC-002)');
});

test('POST /students links to an existing email even when the username is new (STU-002)', async () => {
  const { rows: [existing] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ('STUMAILUSER', 'keep-hash', 'estudiante', 'stumail@example.com') RETURNING id`,
  );

  const { status } = await createStudent({
    username: 'stubrandnew',
    password: 'secret12345',
    nombres: 'Maria',
    apellidos: 'Gomez',
    codalumno: 'LINK002',
    email: 'stumail@example.com',
  });

  assert.equal(status, 201);
  assert.equal(await countUsers('STUBRANDNEW'), 0, 'no account created for the new username');
  const { rows: byEmail } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE email = $1',
    ['stumail@example.com'],
  );
  assert.equal(byEmail[0].n, 1, 'no duplicate email account');

  const { rows: students } = await pool.query(
    'SELECT user_id FROM students WHERE codalumno = $1',
    ['LINK002'],
  );
  assert.equal(students.length, 1);
  assert.equal(students[0].user_id, existing.id, 'links to the user that owns the email');
});

test('POST /students rejects a duplicate codalumno with 409 and persists nothing (STU-003)', async () => {
  await createStudent({
    username: 'studup1',
    password: 'secret12345',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: 'ABC123',
  });

  const { status, body } = await createStudent({
    username: 'studup2',
    password: 'secret12345',
    nombres: 'Otro',
    apellidos: 'Alumno',
    codalumno: 'abc123', // different casing: case-insensitive duplicate
  });

  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');
  assert.equal(await countUsers('STUDUP2'), 0, '409 persists nothing');
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM students WHERE lower(codalumno) = lower($1)',
    ['ABC123'],
  );
  assert.equal(rows[0].n, 1);
});

test('POST /students rejects invalid codalumno, missing fields, and bad email with 400 and persists nothing (STU-001 STU-003 UAC-002)', async () => {
  const payloads = [
    { ...VALID_PAYLOAD, username: 'stubad1', codalumno: '12_34A' },
    { ...VALID_PAYLOAD, username: 'stubad2', codalumno: '2024-00123' },
    { ...VALID_PAYLOAD, username: 'stubad3', codalumno: 'ABC 123' },
    { ...VALID_PAYLOAD, username: 'stubad4', codalumno: undefined }, // missing codalumno (undefined is dropped by JSON)
    { password: 'secret12345', nombres: 'Ana', apellidos: 'Lopez', codalumno: 'BAD005' }, // missing username
    { ...VALID_PAYLOAD, username: 'stubad6', codalumno: 'BAD006', email: 'not-an-email' },
  ];

  for (const payload of payloads) {
    const { status, body } = await createStudent(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }

  for (const username of ['STUBAD1', 'STUBAD2', 'STUBAD3', 'STUBAD4', 'STUBAD5', 'STUBAD6']) {
    assert.equal(await countUsers(username), 0, `${username} must not be persisted`);
  }
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM students WHERE codalumno IN ($1, $2, $3, $4, $5, $6)',
    ['12_34A', '2024-00123', 'ABC 123', 'BAD004', 'BAD005', 'BAD006'],
  );
  assert.equal(rows[0].n, 0);
});

test('POST /students maps a unique-violation race on the account username to 409 CONFLICT, not 500', async () => {
  const app = buildApp({
    userRepository: racingUserRepository(
      'users_username_key',
      'duplicate key value violates unique constraint "users_username_key"',
    ),
  });
  const racingServer = app.listen(0);
  await new Promise((resolve) => racingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${racingServer.address().port}`;

  try {
    const res = await fetch(`${url}/students`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        ...VALID_PAYLOAD,
        username: 'sturace1',
        codalumno: 'RACE001',
        email: 'sturace1@example.com', // must not collide with earlier fixtures' emails (link path)
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.error.code, 'CONFLICT');
    assert.equal(body.error.message, 'username already exists: STURACE1');
    assert.equal(await countUsers('STURACE1'), 0, 'the race persists no account');
  } finally {
    // closeAllConnections destroys the undici keep-alive socket, otherwise
    // close() waits on it and the test runner hangs at teardown.
    await new Promise((resolve) => {
      racingServer.close(resolve);
      racingServer.closeAllConnections();
    });
  }
});

test('POST /students maps a unique-violation race on the account email to 409 CONFLICT, not 500', async () => {
  const app = buildApp({
    userRepository: racingUserRepository(
      'users_email_unique',
      'duplicate key value violates unique constraint "users_email_unique"',
    ),
  });
  const racingServer = app.listen(0);
  await new Promise((resolve) => racingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${racingServer.address().port}`;

  try {
    const res = await fetch(`${url}/students`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        ...VALID_PAYLOAD,
        username: 'sturace2',
        codalumno: 'RACE002',
        email: 'sturace2@example.com',
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.error.code, 'CONFLICT');
    assert.equal(body.error.message, 'email already exists: sturace2@example.com');
    assert.equal(await countUsers('STURACE2'), 0, 'the race persists no account');
  } finally {
    // closeAllConnections destroys the undici keep-alive socket, otherwise
    // close() waits on it and the test runner hangs at teardown.
    await new Promise((resolve) => {
      racingServer.close(resolve);
      racingServer.closeAllConnections();
    });
  }
});

test('POST /students maps a unique-violation race on the codalumno insert to 409 CONFLICT, not 500', async () => {
  const app = buildApp({
    studentRepository: racingStudentRepository(
      'students_codalumno_unique',
      'duplicate key value violates unique constraint "students_codalumno_unique"',
    ),
  });
  const racingServer = app.listen(0);
  await new Promise((resolve) => racingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${racingServer.address().port}`;

  try {
    const res = await fetch(`${url}/students`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        ...VALID_PAYLOAD,
        username: 'sturace3',
        codalumno: 'RACE003',
        email: 'sturace3@example.com', // must not collide with earlier fixtures' emails (link path)
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.error.code, 'CONFLICT');
    assert.equal(body.error.message, 'codalumno already exists: RACE003');
    // The student insert aborts the tx, so the account insert rolls back too (AUD-003).
    assert.equal(await countUsers('STURACE3'), 0, 'the race persists no account');
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM students WHERE codalumno = $1',
      ['RACE003'],
    );
    assert.equal(rows[0].n, 0, 'the race persists no student row');
  } finally {
    // closeAllConnections destroys the undici keep-alive socket, otherwise
    // close() waits on it and the test runner hangs at teardown.
    await new Promise((resolve) => {
      racingServer.close(resolve);
      racingServer.closeAllConnections();
    });
  }
});