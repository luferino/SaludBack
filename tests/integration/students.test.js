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
  username: 'stu-alta-1',
  password: 'secret123',
  nombres: 'Ana',
  apellidos: 'Lopez',
  codalumno: '20240123',
  email: 'stu-alta-1@example.com',
  celular: '+5491100000000',
};

function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/students',
    createStudentRouter({
      repository: new PgStudentRepository(pool),
      userRepository: new PgUserRepository(pool),
      hasher: new BcryptHasher(config.bcryptCost),
      unitOfWork: new PgUnitOfWork(pool),
      ...overrides,
    }),
  );
  app.use(errorHandler);
  return app;
}

let server;
let baseUrl;

before(async () => {
  // Own cleanup: students must be gone before users (FK students.user_id -> users.id).
  // Full FK-order hardening across files is PR 4; this keeps the shared test DB
  // clean so auth.test.js's `DELETE FROM users` never trips on leftover rows.
  await pool.query('DELETE FROM students');
  await pool.query("DELETE FROM users WHERE username LIKE 'stu-%'");
  server = buildApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM students');
  await pool.query("DELETE FROM users WHERE username LIKE 'stu-%'");
  await pool.end();
});

async function createStudent(payload, options = {}) {
  const res = await fetch(`${baseUrl}/students`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
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

test('POST /students performs alta en uno: 201, exact 8-key contract, one estudiante user, linked row (STU-001 STU-004)', async () => {
  const { status, body } = await createStudent(VALID_PAYLOAD);

  assert.equal(status, 201);
  assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
  assert.equal(body.nombres, 'Ana');
  assert.equal(body.apellidos, 'Lopez');
  assert.equal(body.codalumno, '20240123');
  assert.equal(body.email, 'stu-alta-1@example.com');
  assert.equal(body.celular, '+5491100000000');
  assert.equal(body.created_by, null);
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
    ['stu-alta-1'],
  );
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'estudiante');
  assert.notEqual(users[0].password_hash, 'secret123');
  assert.match(users[0].password_hash, /^\$2[aby]\$/);
  assert.equal(users[0].email, 'stu-alta-1@example.com');

  const { rows: students } = await pool.query(
    'SELECT user_id, codalumno, created_by FROM students WHERE codalumno = $1',
    ['20240123'],
  );
  assert.equal(students.length, 1);
  assert.equal(students[0].user_id, users[0].id, 'student row links to the new user (STU-001)');
  assert.equal(students[0].created_by, null);
});

test('POST /students links to an existing username without a duplicate account or role change (STU-002)', async () => {
  const { rows: [existing] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ('stu-link-user', 'keep-hash', 'teacher', NULL) RETURNING id`,
  );

  const { status, body } = await createStudent({
    username: 'stu-link-user',
    password: 'ignored-when-linking',
    nombres: 'Luis',
    apellidos: 'Perez',
    codalumno: 'LINK001',
  });

  assert.equal(status, 201);
  assert.equal(body.created_by, null, 'open route: no actor');

  assert.equal(await countUsers('stu-link-user'), 1, 'no duplicate account');
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
     VALUES ('stu-mail-user', 'keep-hash', 'estudiante', 'stu-mail@example.com') RETURNING id`,
  );

  const { status } = await createStudent({
    username: 'stu-brand-new',
    password: 'secret123',
    nombres: 'Maria',
    apellidos: 'Gomez',
    codalumno: 'LINK002',
    email: 'stu-mail@example.com',
  });

  assert.equal(status, 201);
  assert.equal(await countUsers('stu-brand-new'), 0, 'no account created for the new username');
  const { rows: byEmail } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE email = $1',
    ['stu-mail@example.com'],
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
    username: 'stu-dup-1',
    password: 'secret123',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: 'ABC123',
  });

  const { status, body } = await createStudent({
    username: 'stu-dup-2',
    password: 'secret123',
    nombres: 'Otro',
    apellidos: 'Alumno',
    codalumno: 'abc123', // different casing: case-insensitive duplicate
  });

  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');
  assert.equal(await countUsers('stu-dup-2'), 0, '409 persists nothing');
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM students WHERE lower(codalumno) = lower($1)',
    ['ABC123'],
  );
  assert.equal(rows[0].n, 1);
});

test('POST /students rejects invalid codalumno, missing fields, and bad email with 400 and persists nothing (STU-001 STU-003 UAC-002)', async () => {
  const payloads = [
    { ...VALID_PAYLOAD, username: 'stu-bad-1', codalumno: '12_34A' },
    { ...VALID_PAYLOAD, username: 'stu-bad-2', codalumno: '2024-00123' },
    { ...VALID_PAYLOAD, username: 'stu-bad-3', codalumno: 'ABC 123' },
    { ...VALID_PAYLOAD, username: 'stu-bad-4', codalumno: undefined }, // missing codalumno (undefined is dropped by JSON)
    { password: 'secret123', nombres: 'Ana', apellidos: 'Lopez', codalumno: 'BAD005' }, // missing username
    { ...VALID_PAYLOAD, username: 'stu-bad-6', codalumno: 'BAD006', email: 'not-an-email' },
  ];

  for (const payload of payloads) {
    const { status, body } = await createStudent(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }

  for (const username of ['stu-bad-1', 'stu-bad-2', 'stu-bad-3', 'stu-bad-4', 'stu-bad-5', 'stu-bad-6']) {
    assert.equal(await countUsers(username), 0, `${username} must not be persisted`);
  }
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM students WHERE codalumno IN ($1, $2, $3, $4, $5, $6)',
    ['12_34A', '2024-00123', 'ABC 123', 'BAD004', 'BAD005', 'BAD006'],
  );
  assert.equal(rows[0].n, 0);
});

test('a stub middleware exposing req.auth.sub populates created_by (STU-005 AUD-003)', async () => {
  const actorId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  await pool.query('DELETE FROM users WHERE id = $1', [actorId]);
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [actorId, 'stu-actor', 'not-a-real-hash', 'teacher'],
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { sub: actorId };
    next();
  });
  app.use(
    '/students',
    createStudentRouter({
      repository: new PgStudentRepository(pool),
      userRepository: new PgUserRepository(pool),
      hasher: new BcryptHasher(config.bcryptCost),
      unitOfWork: new PgUnitOfWork(pool),
    }),
  );
  app.use(errorHandler);

  const actorServer = app.listen(0);
  await new Promise((resolve) => actorServer.once('listening', resolve));
  const url = `http://127.0.0.1:${actorServer.address().port}`;

  try {
    const res = await fetch(`${url}/students`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'stu-act-1',
        password: 'secret123',
        nombres: 'Ana',
        apellidos: 'Lopez',
        codalumno: 'ACTOR001',
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.created_by, actorId);

    const { rows } = await pool.query(
      'SELECT created_by FROM students WHERE codalumno = $1',
      ['ACTOR001'],
    );
    assert.equal(rows[0].created_by, actorId);
  } finally {
    await new Promise((resolve) => actorServer.close(resolve));
  }
});

test('a garbage Bearer token on the open route still creates with created_by null (STU-005)', async () => {
  const { status, body } = await createStudent(
    {
      username: 'stu-garb-1',
      password: 'secret123',
      nombres: 'Ana',
      apellidos: 'Lopez',
      codalumno: 'GARB001',
    },
    { headers: { authorization: 'Bearer not.a.jwt' } },
  );

  assert.equal(status, 201);
  assert.equal(body.created_by, null);

  const { rows } = await pool.query('SELECT created_by FROM students WHERE codalumno = $1', [
    'GARB001',
  ]);
  assert.equal(rows[0].created_by, null);
});