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
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { cleanDb } from './helpers/clean-db.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const CONTRACT_KEYS = ['id', 'nombres', 'apellidos', 'email', 'celular', 'created_by', 'created_at'];

const VALID_PAYLOAD = {
  username: 'tea-alta-1',
  password: 'secret123',
  nombres: 'Maria',
  apellidos: 'Ruiz',
  email: 'tea-alta-1@example.com',
  celular: '+5491100000000',
};

function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/teachers',
    createTeacherRouter({
      repository: new PgTeacherRepository(pool),
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
  // Own cleanup: teachers must be gone before users (FK teachers.user_id -> users.id).
  // Full FK-order hardening across files is PR 4; this keeps the shared test DB
  // clean so auth.test.js's `DELETE FROM users` never trips on leftover rows.
  await cleanDb(pool);
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

test('POST /teachers performs alta en uno: 201, exact 7-key contract, one teacher user, linked row (TEA-001 TEA-003)', async () => {
  const { status, body } = await createTeacher(VALID_PAYLOAD);

  assert.equal(status, 201);
  assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
  assert.equal(body.nombres, 'Maria');
  assert.equal(body.apellidos, 'Ruiz');
  assert.equal(body.email, 'tea-alta-1@example.com');
  assert.equal(body.celular, '+5491100000000');
  assert.equal(body.created_by, null);
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
    ['tea-alta-1'],
  );
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'teacher');
  assert.notEqual(users[0].password_hash, 'secret123');
  assert.match(users[0].password_hash, /^\$2[aby]\$/);
  assert.equal(users[0].email, 'tea-alta-1@example.com');

  const { rows: teachers } = await pool.query(
    'SELECT user_id, email, created_by FROM teachers WHERE user_id = $1',
    [users[0].id],
  );
  assert.equal(teachers.length, 1);
  assert.equal(teachers[0].user_id, users[0].id, 'teacher row links to the new user (TEA-001)');
  assert.equal(teachers[0].email, 'tea-alta-1@example.com');
  assert.equal(teachers[0].created_by, null);
});

test('POST /teachers links to an existing username without a duplicate account or role change (TEA-002)', async () => {
  const { rows: [existing] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ('tea-link-user', 'keep-hash', 'estudiante', NULL) RETURNING id`,
  );

  const { status, body } = await createTeacher({
    username: 'tea-link-user',
    password: 'ignored-when-linking',
    nombres: 'Luis',
    apellidos: 'Perez',
  });

  assert.equal(status, 201);
  assert.equal(body.created_by, null, 'open route: no actor');

  assert.equal(await countUsers('tea-link-user'), 1, 'no duplicate account');
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
     VALUES ('tea-mail-user', 'keep-hash', 'teacher', 'tea-mail@example.com') RETURNING id`,
  );

  const { status } = await createTeacher({
    username: 'tea-brand-new',
    password: 'secret123',
    nombres: 'Ana',
    apellidos: 'Gomez',
    email: 'tea-mail@example.com',
  });

  assert.equal(status, 201);
  assert.equal(await countUsers('tea-brand-new'), 0, 'no account created for the new username');
  const { rows: byEmail } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE email = $1',
    ['tea-mail@example.com'],
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
    { ...VALID_PAYLOAD, username: 'tea-bad-1', nombres: badNombres[0], apellidos: undefined }, // missing apellidos (TEA-001 scenario)
    { password: 'secret123', nombres: badNombres[1], apellidos: 'Lopez' }, // missing username
    { username: 'tea-bad-3', nombres: badNombres[2], apellidos: 'Lopez' }, // missing password
    { username: 'tea-bad-4', password: 'secret123', nombres: badNombres[3] }, // missing apellidos
    { username: 'tea-bad-5', password: 'secret123', nombres: badNombres[4], apellidos: '' }, // blank apellidos
    { ...VALID_PAYLOAD, username: 'tea-bad-6', nombres: badNombres[5], email: 'not-an-email' },
  ];

  for (const payload of payloads) {
    const { status, body } = await createTeacher(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }

  for (const username of ['tea-bad-1', 'tea-bad-2', 'tea-bad-3', 'tea-bad-4', 'tea-bad-5', 'tea-bad-6']) {
    assert.equal(await countUsers(username), 0, `${username} must not be persisted`);
  }
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM teachers WHERE nombres = ANY($1)',
    [badNombres],
  );
  assert.equal(rows[0].n, 0);
});

test('the REAL authenticate middleware maps a signed token sub to created_by (TEA-004 AUD-003)', async () => {
  const actorId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  await pool.query('DELETE FROM users WHERE id = $1', [actorId]);
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [actorId, 'tea-actor', 'not-a-real-hash', 'teacher'],
  );

  const tokenService = new JwtTokenService({
    secret: config.jwtSecret,
    expiresIn: config.jwtExpiresIn,
  });
  const token = await tokenService.sign({
    sub: actorId,
    username: 'tea-actor',
    role: 'teacher',
    permissions: [],
  });

  const app = express();
  app.use(express.json());
  app.use(
    '/teachers',
    authenticate(tokenService),
    createTeacherRouter({
      repository: new PgTeacherRepository(pool),
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
    const res = await fetch(`${url}/teachers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        username: 'tea-act-1',
        password: 'secret123',
        nombres: 'Ana',
        apellidos: 'Lopez',
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.created_by, actorId);

    const { rows } = await pool.query(
      'SELECT created_by FROM teachers WHERE user_id = (SELECT id FROM users WHERE username = $1)',
      ['tea-act-1'],
    );
    assert.equal(rows[0].created_by, actorId);

    // Malformed token through the REAL middleware: rejected with 401 and the
    // handler never runs (open-route 201 + NULL stays covered by the test
    // below — PAT-004/TEA-004 invalid-token scenario).
    const malformed = await fetch(`${url}/teachers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer not.a.jwt',
      },
      body: JSON.stringify({
        username: 'tea-act-2',
        password: 'secret123',
        nombres: 'Ana',
        apellidos: 'Lopez',
      }),
    });
    assert.equal(malformed.status, 401);
    assert.equal(await countUsers('tea-act-2'), 0);
  } finally {
    await new Promise((resolve) => actorServer.close(resolve));
  }
});

test('a garbage Bearer token on the open route still creates with created_by null (TEA-004)', async () => {
  const { status, body } = await createTeacher(
    {
      username: 'tea-garb-1',
      password: 'secret123',
      nombres: 'Ana',
      apellidos: 'Lopez',
    },
    { headers: { authorization: 'Bearer not.a.jwt' } },
  );

  assert.equal(status, 201);
  assert.equal(body.created_by, null);

  const { rows } = await pool.query(
    'SELECT created_by FROM teachers WHERE user_id = (SELECT id FROM users WHERE username = $1)',
    ['tea-garb-1'],
  );
  assert.equal(rows[0].created_by, null);
});