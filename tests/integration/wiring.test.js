import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import config from '../../src/config.ts';
import { createApp } from '../../src/app.ts';
import { cleanDb } from './helpers/clean-db.js';

/**
 * End-to-end wiring coverage (PR 4, task 4.1): the REAL app factory used by
 * index.ts mounts /auth, /patients, /students and /teachers together with the
 * shared pool, repositories and unit of work. These tests prove every router
 * is reachable through the production wiring and that alta en uno persists
 * linked rows the same way the isolated router suites do.
 */
const pool = new pg.Pool({ connectionString: config.databaseUrl });

let server;
let baseUrl;

async function post(path, body, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  // FK-safe cleanup (shared DB; students/teachers/patients/tokens before users).
  await cleanDb(pool);

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

test('POST /auth/register is reachable through the wiring (auth router mounted)', async () => {
  const { status, body } = await post('/auth/register', {
    username: 'wiring-auth-1',
    password: 'secret123',
    email: 'wiring-auth-1@example.com',
  });

  assert.equal(status, 201);
  assert.equal(body.role, 'estudiante');
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [
    'wiring-auth-1',
  ]);
  assert.equal(rows[0].n, 1);
});

test('POST /students alta en uno works through the wiring (student router mounted)', async () => {
  const { status, body } = await post('/students', {
    username: 'wiring-stu-1',
    password: 'secret123',
    nombres: 'Ana',
    apellidos: 'Lopez',
    codalumno: 'WIRING001',
    email: 'wiring-stu-1@example.com',
    celular: '+5491100000000',
  });

  assert.equal(status, 201);
  assert.equal(body.codalumno, 'WIRING001');
  assert.equal(body.created_by, null);

  const { rows: users } = await pool.query('SELECT id, role FROM users WHERE username = $1', [
    'wiring-stu-1',
  ]);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'estudiante');
  const { rows: students } = await pool.query('SELECT user_id FROM students WHERE codalumno = $1', [
    'WIRING001',
  ]);
  assert.equal(students.length, 1);
  assert.equal(students[0].user_id, users[0].id);
});

test('POST /teachers alta en uno works through the wiring (teacher router mounted)', async () => {
  const { status, body } = await post('/teachers', {
    username: 'wiring-tea-1',
    password: 'secret123',
    nombres: 'Maria',
    apellidos: 'Ruiz',
    email: 'wiring-tea-1@example.com',
    celular: '+5491100000000',
  });

  assert.equal(status, 201);
  assert.equal(body.nombres, 'Maria');
  assert.equal(body.apellidos, 'Ruiz');
  assert.equal(body.created_by, null);

  const { rows: users } = await pool.query('SELECT id, role FROM users WHERE username = $1', [
    'wiring-tea-1',
  ]);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'teacher');
  const { rows: teachers } = await pool.query('SELECT user_id FROM teachers WHERE user_id = $1', [
    users[0].id,
  ]);
  assert.equal(teachers.length, 1);
});

test('POST /patients is reachable through the wiring (patient router mounted)', async () => {
  const { status, body } = await post('/patients', {
    documento: '99999999',
    nombres: 'Ana',
    apellidos: 'Lopez',
    fecha_nacimiento: '1990-04-12',
    email: 'wiring-pat@example.com',
    celular: '+5491100000000',
    sexo: 'F',
    direccion: 'Av. Siempre Viva 742',
  });

  assert.equal(status, 201);
  assert.equal(body.documento, '99999999');
  assert.equal(body.created_by, null);
});