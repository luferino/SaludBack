import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import config from '../../src/config.js';
import { createAuthRouter } from '../../src/modules/auth/infrastructure/routes/auth.routes.js';
import { PgUserRepository } from '../../src/modules/auth/infrastructure/repositories/pg-user-repository.js';
import { BcryptHasher } from '../../src/modules/auth/infrastructure/services/bcrypt-hasher.js';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token-service.js';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.js';
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
      tokenService: new JwtTokenService({
        secret: config.jwtSecret,
        expiresIn: config.jwtExpiresIn,
      }),
      guard,
    }),
  );
  app.use(errorHandler);
  return app;
}

function buildProtectedApp(tokenService) {
  const app = express();
  app.use(express.json());
  app.use('/secure', authenticate(tokenService), (req, res) => {
    res.json({ auth: req.auth });
  });
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

async function login(body) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('POST /auth/register creates an estudiante with a bcrypt hash and email', async () => {
  const { status, body } = await register({
    username: 'jperez',
    password: 'secret123',
    email: 'jperez@example.com',
  });
  assert.equal(status, 201);
  assert.equal(body.username, 'jperez');
  assert.equal(body.role, 'estudiante');
  assert.equal(body.email, 'jperez@example.com');
  assert.equal(body.passwordHash, undefined);

  const { rows } = await pool.query('SELECT password_hash, email FROM users WHERE username = $1', [
    'jperez',
  ]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].password_hash, 'secret123');
  assert.match(rows[0].password_hash, /^\$2[aby]\$/);
  assert.equal(rows[0].email, 'jperez@example.com');
});

test('POST /auth/register rejects a duplicate username with 409', async () => {
  await register({ username: 'mperez', password: 'secret123', email: 'mperez@example.com' });
  const { status, body } = await register({
    username: 'mperez',
    password: 'otra-clave',
    email: 'mperez-otro@example.com',
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username = $1',
    ['mperez'],
  );
  assert.equal(rows[0].n, 1);
});

test('POST /auth/register rejects a duplicate email with 409', async () => {
  await register({ username: 'dperez', password: 'secret123', email: 'dup@example.com' });
  const { status, body } = await register({
    username: 'dperez-otro',
    password: 'secret123',
    email: 'dup@example.com',
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username = $1',
    ['dperez-otro'],
  );
  assert.equal(rows[0].n, 0);
});

test('POST /auth/register rejects missing or empty fields with 400', async () => {
  const payloads = [
    { password: 'secret123', email: 'a@example.com' },
    { username: '', password: 'secret123', email: 'a@example.com' },
    { username: '   ', password: 'secret123', email: 'a@example.com' },
    { username: 'nuevo', email: 'a@example.com' },
    { username: 'nuevo2', password: '', email: 'a@example.com' },
    { username: 'nuevo3', password: 'secret123' },
    { username: 'nuevo4', password: 'secret123', email: 'not-an-email' },
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

test('POST /auth/login returns 200 with a token carrying role and permissions', async () => {
  await register({ username: 'lperez', password: 'secret123', email: 'lperez@example.com' });
  const { status, body } = await login({ username: 'lperez', password: 'secret123' });

  assert.equal(status, 200);
  assert.equal(typeof body.token, 'string');
  assert.equal(body.password, undefined);

  const decoded = jwt.decode(body.token);
  assert.equal(decoded.role, 'estudiante');
  assert.equal(decoded.username, 'lperez');
  assert.ok(Array.isArray(decoded.permissions));
  assert.ok(decoded.permissions.length > 0);
});

test('POST /auth/login rejects an unknown username with a generic 401', async () => {
  const { status, body } = await login({ username: 'ghost', password: 'whatever' });
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(body.error.message, 'Invalid credentials');
});

test('POST /auth/login rejects a wrong password with the same body as an unknown username', async () => {
  const wrongPassword = await login({ username: 'lperez', password: 'wrong-pass' });
  const unknownUser = await login({ username: 'ghost', password: 'whatever' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(wrongPassword.body, unknownUser.body);
});

test('POST /auth/login rejects missing or empty fields with 400', async () => {
  const payloads = [
    {},
    { password: 'secret123' },
    { username: '', password: 'secret123' },
    { username: '   ', password: 'secret123' },
    { username: 'lperez' },
    { username: 'lperez', password: '' },
  ];
  for (const payload of payloads) {
    const { status, body } = await login(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }
});

test('protected route passes a valid token and exposes role and permissions', async () => {
  const tokenService = new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const token = await tokenService.sign({
    sub: 'uuid-1',
    username: 'lperez',
    role: 'estudiante',
    permissions: ['profile:read'],
  });

  const protectedServer = buildProtectedApp(tokenService).listen(0);
  await new Promise((resolve) => protectedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${protectedServer.address().port}`;

  const res = await fetch(`${url}/secure`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { auth: { role: 'estudiante', permissions: ['profile:read'] } });

  await new Promise((resolve) => protectedServer.close(resolve));
});

test('protected route rejects missing, malformed and expired tokens with 401', async () => {
  const tokenService = new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const expired = await new JwtTokenService({ secret: config.jwtSecret, expiresIn: -1 }).sign({
    sub: 'uuid-1',
    username: 'lperez',
    role: 'estudiante',
    permissions: [],
  });

  const protectedServer = buildProtectedApp(tokenService).listen(0);
  await new Promise((resolve) => protectedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${protectedServer.address().port}`;

  const requests = [
    fetch(`${url}/secure`),
    fetch(`${url}/secure`, { headers: { authorization: 'Bearer not.a.jwt' } }),
    fetch(`${url}/secure`, { headers: { authorization: `Bearer ${expired}` } }),
  ];
  for (const request of requests) {
    const res = await request;
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  }

  await new Promise((resolve) => protectedServer.close(resolve));
});
