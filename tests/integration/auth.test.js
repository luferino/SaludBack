import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import config from '../../src/config.js';
import { createAuthRouter } from '../../src/modules/auth/infrastructure/routes/auth.routes.js';
import { PgUserRepository } from '../../src/modules/auth/infrastructure/repositories/pg-user-repository.js';
import { BcryptHasher } from '../../src/modules/auth/infrastructure/services/bcrypt-hasher.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { OpenGuard, Guard } from '../../src/modules/shared/application/guard.js';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

function buildApp(guard) {
  const app = express();
  app.use(express.json());
  app.use(
    '/auth',
    createAuthRouter({
      repository: new PgUserRepository(pool),
      hasher: new BcryptHasher(config.bcryptCost),
      guard,
    }),
  );
  app.use(errorHandler);
  return app;
}

let server;
let baseUrl;

before(async () => {
  await pool.query('DELETE FROM users');
  server = buildApp(new OpenGuard()).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function register(body) {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('POST /auth/register creates an estudiante with a bcrypt hash', async () => {
  const { status, body } = await register({ username: 'jperez', password: 'secret123' });
  assert.equal(status, 201);
  assert.equal(body.username, 'jperez');
  assert.equal(body.role, 'estudiante');
  assert.equal(body.passwordHash, undefined);

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE username = $1', [
    'jperez',
  ]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].password_hash, 'secret123');
  assert.match(rows[0].password_hash, /^\$2[aby]\$/);
});

test('POST /auth/register rejects a duplicate username with 409', async () => {
  await register({ username: 'mperez', password: 'secret123' });
  const { status, body } = await register({ username: 'mperez', password: 'otra-clave' });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username = $1',
    ['mperez'],
  );
  assert.equal(rows[0].n, 1);
});

test('POST /auth/register rejects missing or empty fields with 400', async () => {
  const payloads = [
    { password: 'secret123' },
    { username: '', password: 'secret123' },
    { username: '   ', password: 'secret123' },
    { username: 'nuevo' },
    { username: 'nuevo2', password: '' },
  ];
  for (const payload of payloads) {
    const { status, body } = await register(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }
});

test('an attached guard rejects the request before the use case runs', async () => {
  class AdminGuard extends Guard {
    async authorize() {
      throw new UnauthorizedError();
    }
  }

  const guardedServer = buildApp(new AdminGuard()).listen(0);
  await new Promise((resolve) => guardedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${guardedServer.address().port}`;

  const res = await fetch(`${url}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'blocked-user', password: 'secret123' }),
  });
  assert.equal(res.status, 401);

  await new Promise((resolve) => guardedServer.close(resolve));
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username = $1',
    ['blocked-user'],
  );
  assert.equal(rows[0].n, 0);
});
