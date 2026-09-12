import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import config from '../../src/config.ts';
import { createApp } from '../../src/app.ts';
import { cleanDb } from './helpers/clean-db.js';
import { CreateAdmin } from '../../src/modules/auth/application/create-admin.usecase.ts';
import { PgUserRepository } from '../../src/modules/auth/infrastructure/repositories/pg-user.repository.ts';
import { BcryptHasher } from '../../src/modules/auth/infrastructure/services/bcrypt-hasher.service.ts';

/**
 * End-to-end bootstrap proof: the exact wiring src/scripts/create-admin.ts
 * uses (real pool + real BcryptHasher + CreateAdmin against the test DB)
 * creates an admin, that admin logs in through the REAL app factory
 * (src/app.ts), and the resulting token authorizes a protected alta. This
 * exercises the production bootstrap loop end to end:
 * create-admin CLI -> POST /auth/login -> admin-authorized POST /students.
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

test('bootstrap admin: CreateAdmin -> login -> protected alta works end to end', async () => {
  // (a) Create the admin through the same wiring src/scripts/create-admin.ts uses.
  const useCase = new CreateAdmin({
    repository: new PgUserRepository(pool),
    hasher: new BcryptHasher(config.bcryptCost),
  });
  const admin = await useCase.execute({ username: 'bootadmin', password: 'Adminpass123' });
  assert.equal(admin.username, 'BOOTADMIN');
  assert.equal(admin.role, 'admin');
  assert.ok(admin.id, 'the persisted admin has an id');

  // (b) Login with those credentials through the real app factory.
  const login = await post('/auth/login', { username: 'bootadmin', password: 'Adminpass123' });
  assert.equal(login.status, 200);
  const decoded = jwt.decode(login.body.token);
  assert.equal(decoded.role, 'admin');
  assert.equal(decoded.sub, admin.id, 'token sub is the bootstrap admin id');

  // (c) Use the token on a protected alta endpoint.
  const { status, body } = await post(
    '/students',
    {
      username: 'bootstu1',
      password: 'secret12345',
      nombres: 'Ana',
      apellidos: 'Lopez',
      codalumno: 'BOOT001',
      email: 'bootstu1@example.com',
      celular: '+5491100000000',
    },
    { headers: { authorization: `Bearer ${login.body.token}` } },
  );
  assert.equal(status, 201);
  assert.equal(body.codalumno, 'BOOT001');
  assert.equal(body.created_by, admin.id, 'the bootstrap admin token sub lands in created_by');

  const { rows: users } = await pool.query('SELECT role FROM users WHERE username = $1', [
    'BOOTSTU1',
  ]);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'estudiante');
});