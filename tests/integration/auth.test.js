import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import config from '../../src/config.ts';
import { createAuthRouter } from '../../src/modules/auth/infrastructure/routes/auth.routes.ts';
import { PgUserRepository } from '../../src/modules/auth/infrastructure/repositories/pg-user.repository.ts';
import { PgResetTokenRepository } from '../../src/modules/auth/infrastructure/repositories/pg-reset-token.repository.ts';
import { BcryptHasher } from '../../src/modules/auth/infrastructure/services/bcrypt-hasher.service.ts';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { AdminGuard, PermissionGuard } from '../../src/modules/shared/application/guard.ts';
import { PgPermissionMatrixRepository } from '../../src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts';
import { cleanDb } from './helpers/clean-db.js';
import { seedAdmin, tokenForRole, expiredTokenForRole, setRolePermissions } from './helpers/admin-token.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const GENERIC_FORGOT_BODY = {
  message: 'If the account exists, a password reset link has been sent',
};

/** Records mailed messages so tests can assert content and replay tokens. */
class RecordingMailer {
  constructor() {
    this.messages = [];
  }

  clear() {
    this.messages = [];
  }

  async sendMail(message) {
    this.messages.push(message);
  }
}

const mailer = new RecordingMailer();

/**
 * Builds the production-like guarded auth router: authenticate FIRST (via
 * registerMiddleware), AdminGuard SECOND (inside the register handler);
 * login, forgot-password and reset-password stay unauthenticated.
 */
function buildApp(guardOverride) {
  const app = express();
  app.use(express.json());
  const tokenService = new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const matrixReader = new PgPermissionMatrixRepository(pool);
  app.use(
    '/auth',
    createAuthRouter({
      repository: new PgUserRepository(pool),
      hasher: new BcryptHasher(config.bcryptCost),
      tokenService,
      matrixReader,
      resetTokenRepository: new PgResetTokenRepository(pool, config.resetTokenMaxOutstanding),
      mailer,
      clientUrl: config.clientUrl,
      resetTokenTtl: config.resetTokenTtl,
      guard: guardOverride ?? new AdminGuard(),
      registerMiddleware: authenticate(tokenService, matrixReader),
      meMiddleware: authenticate(tokenService, matrixReader),
      meGuard: new PermissionGuard('profile:read'),
    }),
  );
  app.use(errorHandler);
  return app;
}

function buildProtectedApp(tokenService, matrixReader) {
  const app = express();
  app.use(express.json());
  app.use('/secure', authenticate(tokenService, matrixReader), (req, res) => {
    res.json({ auth: req.auth });
  });
  app.use(errorHandler);
  return app;
}

let server;
let baseUrl;
let adminId;
let adminToken;

before(async () => {
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

async function register(body) {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Sends to register WITHOUT the admin token (for the 401/403 tests). */
async function registerUnprotected(body, headers = {}) {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
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

async function forgot(body) {
  const res = await fetch(`${baseUrl}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function reset(body) {
  const res = await fetch(`${baseUrl}/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Extracts the raw token from the reset link mailed by the recording mailer. */
function lastResetToken() {
  const link = mailer.messages.at(-1).text;
  return new URL(link).searchParams.get('token');
}

// --- register protection tests ---

test('POST /auth/register without a token is rejected with 401', async () => {
  const { status, body } = await registerUnprotected({
    username: 'blocked',
    password: 'secret12345',
    email: 'blocked@example.com',
  });
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('POST /auth/register with a non-admin token is rejected with 403', async () => {
  const { status, body } = await registerUnprotected(
    { username: 'blocked2', password: 'secret12345', email: 'blocked2@example.com' },
    { authorization: `Bearer ${await tokenForRole('estudiante')}` },
  );
  assert.equal(status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
});

// --- register happy / edge cases (all behind admin token) ---

test('POST /auth/register creates an estudiante with a bcrypt hash and email', async () => {
  const { status, body } = await register({
    username: 'jperez',
    password: 'secret12345',
    email: 'jperez@example.com',
  });
  assert.equal(status, 201);
  assert.equal(body.username, 'JPEREZ');
  assert.equal(body.role, 'estudiante');
  assert.equal(body.email, 'jperez@example.com');
  assert.equal(body.passwordHash, undefined);

  const { rows } = await pool.query('SELECT password_hash, email FROM users WHERE username = $1', [
    'JPEREZ',
  ]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].password_hash, 'secret12345');
  assert.match(rows[0].password_hash, /^\$2[aby]\$/);
  assert.equal(rows[0].email, 'jperez@example.com');
});

test('POST /auth/register rejects a duplicate username with 409', async () => {
  await register({ username: 'mperez', password: 'secret12345', email: 'mperez@example.com' });
  const { status, body } = await register({
    username: 'mperez',
    password: 'otraclave123',
    email: 'mperez-otro@example.com',
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username = $1',
    ['MPEREZ'],
  );
  assert.equal(rows[0].n, 1);
});

test('POST /auth/register rejects a duplicate email with 409', async () => {
  await register({ username: 'dperez', password: 'secret12345', email: 'dup@example.com' });
  const { status, body } = await register({
    username: 'dperez2',
    password: 'secret12345',
    email: 'dup@example.com',
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username = $1',
    ['DPEREZ2'],
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

test('POST /auth/register records the admin actor in created_by and creates no students row (REG-001 AUD-003)', async () => {
  const { status, body } = await register({
    username: 'audituser',
    password: 'secret12345',
    email: 'audituser@example.com',
  });
  assert.equal(status, 201);

  const { rows } = await pool.query(
    'SELECT created_by, updated_by, updated_at FROM users WHERE username = $1',
    ['AUDITUSER'],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].created_by, adminId, 'registration records the admin token sub in created_by (AUD-003)');
  assert.equal(rows[0].updated_by, null);
  assert.equal(rows[0].updated_at, null);

  const { rows: students } = await pool.query(
    'SELECT count(*)::int AS n FROM students WHERE user_id = $1',
    [body.id],
  );
  assert.equal(students[0].n, 0, 'registration is account-only: no students row (REG-001)');
});

// --- login ---

test('POST /auth/login returns 200 with a token carrying role and permissions', async () => {
  await register({ username: 'lperez', password: 'secret12345', email: 'lperez@example.com' });
  const { status, body } = await login({ username: 'lperez', password: 'secret12345' });

  assert.equal(status, 200);
  assert.equal(typeof body.token, 'string');
  assert.equal(body.password, undefined);

  const decoded = jwt.decode(body.token);
  assert.equal(decoded.role, 'estudiante');
  assert.equal(decoded.username, 'LPEREZ');
  assert.ok(Array.isArray(decoded.permissions));
  assert.ok(decoded.permissions.length > 0);
});

test('POST /auth/login issues a teacher token with role, permissions and sub claims (AUTH-001)', async () => {
  const hasher = new BcryptHasher(config.bcryptCost);
  const passwordHash = await hasher.hash('teacherpass1');
  const { rows: [teacher] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ('TCLAIMS', $1, 'teacher', 'tclaims@example.com') RETURNING id`,
    [passwordHash],
  );

  const { status, body } = await login({ username: 'tclaims', password: 'teacherpass1' });
  assert.equal(status, 200);

  const decoded = jwt.decode(body.token);
  assert.equal(decoded.role, 'teacher');
  assert.deepEqual(decoded.permissions, ['materias:read', 'profile:read', 'turnos:read'], 'derived from seeded role_permissions');
  assert.equal(decoded.sub, teacher.id, 'sub claim equals the authenticated user id (AUTH-002)');
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

// --- authenticate middleware integration ---

test('protected route passes a valid token and exposes role, permissions, sub and userId', async () => {
  const tokenService = new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const token = await tokenService.sign({
    sub: 'uuid-1',
    username: 'lperez',
    role: 'estudiante',
    permissions: ['profile:read'],
  });

  const protectedServer = buildProtectedApp(tokenService, new PgPermissionMatrixRepository(pool)).listen(0);
  await new Promise((resolve) => protectedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${protectedServer.address().port}`;

  const res = await fetch(`${url}/secure`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    auth: { role: 'estudiante', permissions: ['materias:read', 'profile:read', 'turnos:read'], sub: 'uuid-1', userId: 'uuid-1' },
  });

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

  const protectedServer = buildProtectedApp(tokenService, new PgPermissionMatrixRepository(pool)).listen(0);
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

// --- GET /auth/me (PR-001 / PR-002) ---

test('GET /auth/me returns exactly username, email and role for the profile-less admin (200, PR-001)', async () => {
  const res = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.deepEqual(body, { username: 'ADMINBOOT', email: null, role: 'admin' });
  assert.deepEqual(Object.keys(body).sort(), ['email', 'role', 'username']);
  assert.equal(body.passwordHash, undefined);
  assert.equal('id' in body, false);
  assert.equal('sub' in body, false);
  assert.equal('permissions' in body, false);
  assert.equal('createdBy' in body, false);
});

test('GET /auth/me without a token is rejected with 401 and the read does not run (PR-002)', async () => {
  const res = await fetch(`${baseUrl}/auth/me`);
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(body.error.message, 'Invalid or missing token');
});

test('GET /auth/me with an expired token is rejected with 401 (PR-002)', async () => {
  const res = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${await expiredTokenForRole('admin')}` },
  });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(body.error.message, 'Invalid or missing token');
});

test('GET /auth/me rejects a verified token whose userId matches no row with 401 (PR-002)', async () => {
  const signer = new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const token = await signer.sign({
    sub: 'ffffffff-ffff-4fff-9fff-ffffffffffff',
    username: 'GHOST',
    role: 'estudiante',
    permissions: ['profile:read'],
  });

  const res = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('GET /auth/me rejects a verified token whose userId is a non-UUID sub with 401, not 500 (PR-002)', async () => {
  // tokenForRole signs an intentionally non-queryable sub (40-char
  // non-UUID string). The use case must reject the malformed identity
  // BEFORE the DB read — otherwise the WHERE id = $1 uuid cast raises
  // Postgres 22P02 and the error handler answers 500.
  const res = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${await tokenForRole('estudiante')}` },
  });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(body.error.message, 'Invalid or missing token');
});

test('GET /auth/me rejects a verified token without profile:read with 403 (PR-002)', async () => {
  // Use a custom role that genuinely lacks profile:read in the DB, so the
  // PermissionGuard('profile:read') rejects before the use case runs.
  const NO_PROFILE_ROLE = 'test_noprofile';
  await setRolePermissions(pool, NO_PROFILE_ROLE, ['users:write']);

  const signer = new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const token = await signer.sign({
    sub: 'no-profile-0000-0000-0000-000000000000',
    username: 'NOPROFILE',
    role: NO_PROFILE_ROLE,
    permissions: ['users:write'],
  });

  const res = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);

  const body = await res.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('GET /auth/me reads the email fresh from the database, not from token claims (PR-001)', async () => {
  await register({ username: 'freshme', password: 'secret12345', email: 'old@example.com' });
  const { body: loginBody } = await login({ username: 'freshme', password: 'secret12345' });

  await pool.query('UPDATE users SET email = $1 WHERE username = $2', [
    'new@example.com',
    'FRESHME',
  ]);

  const res = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.deepEqual(body, { username: 'FRESHME', email: 'new@example.com', role: 'estudiante' });
  assert.deepEqual(Object.keys(body).sort(), ['email', 'role', 'username']);
});

// --- password recovery (still unauthenticated, unchanged) ---

test('POST /auth/forgot-password mails a reset link to a user with email', async () => {
  mailer.clear();
  await register({ username: 'rperez', password: 'secret12345', email: 'rperez@example.com' });

  const { status, body } = await forgot({ username: 'rperez' });

  assert.equal(status, 200);
  assert.deepEqual(body, GENERIC_FORGOT_BODY);
  assert.equal(mailer.messages.length, 1);
  assert.equal(mailer.messages[0].to, 'rperez@example.com');
  assert.equal(mailer.messages[0].subject, 'Password reset');
  assert.ok(mailer.messages[0].text.startsWith(`${config.clientUrl}?token=`));
});

test('POST /auth/forgot-password is identical for unknown and email-less users and mails nothing', async () => {
  mailer.clear();
  await pool.query(
    'INSERT INTO users (username, password_hash, role, email) VALUES ($1, $2, $3, NULL)',
    ['LEGACYUSER', 'not-a-real-hash', 'estudiante'],
  );

  const unknown = await forgot({ username: 'ghostuser' });
  const emailLess = await forgot({ username: 'legacyuser' });

  assert.equal(unknown.status, 200);
  assert.equal(emailLess.status, 200);
  assert.deepEqual(unknown.body, GENERIC_FORGOT_BODY);
  assert.deepEqual(emailLess.body, GENERIC_FORGOT_BODY);
  assert.deepEqual(unknown.body, emailLess.body);
  assert.equal(mailer.messages.length, 0);
});

test('POST /auth/reset-password rejects missing or empty fields with 400', async () => {
  const payloads = [
    {},
    { token: 'abc123' },
    { newPassword: 'newpass456' },
    { token: '', newPassword: 'newpass456' },
    { token: '   ', newPassword: 'newpass456' },
  ];
  for (const payload of payloads) {
    const { status, body } = await reset(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }
});

test('forgot then reset: old password stops working, new one works, token is single-use', async () => {
  mailer.clear();
  await register({ username: 'e2euser', password: 'oldpass123', email: 'e2e@example.com' });

  const forgotRes = await forgot({ username: 'e2euser' });
  assert.equal(forgotRes.status, 200);

  const token = lastResetToken();
  assert.ok(token);

  const resetRes = await reset({ token, newPassword: 'newpass456' });
  assert.equal(resetRes.status, 200);
  assert.deepEqual(resetRes.body, { message: 'Password has been reset' });

  const oldLogin = await login({ username: 'e2euser', password: 'oldpass123' });
  assert.equal(oldLogin.status, 401);

  const newLogin = await login({ username: 'e2euser', password: 'newpass456' });
  assert.equal(newLogin.status, 200);

  const reuse = await reset({ token, newPassword: 'anotherpass1' });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error.code, 'BAD_REQUEST');
  assert.equal(reuse.body.error.message, 'Invalid or expired reset token');
});

test('an expired reset token is rejected with the password unchanged', async () => {
  mailer.clear();
  await register({ username: 'expuser', password: 'keepme12345', email: 'exp@example.com' });
  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE username = $1', [
    'EXPUSER',
  ]);

  const rawToken = 'expired-raw-token';
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() - interval '1 minute')`,
    [userRows[0].id, tokenHash],
  );

  const res = await reset({ token: rawToken, newPassword: 'newpass456' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');

  const loginStillWorks = await login({ username: 'expuser', password: 'keepme12345' });
  assert.equal(loginStillWorks.status, 200);
});

test('issuing beyond the outstanding cap invalidates the oldest token', async () => {
  mailer.clear();
  await register({ username: 'capuser', password: 'secret12345', email: 'cap@example.com' });
  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE username = $1', [
    'CAPUSER',
  ]);
  const cap = config.resetTokenMaxOutstanding;

  for (let i = 0; i <= cap; i += 1) {
    const res = await forgot({ username: 'capuser' });
    assert.equal(res.status, 200);
  }

  const { rows: tokens } = await pool.query(
    `SELECT token_hash, used_at IS NOT NULL AS used
     FROM password_reset_tokens
     WHERE user_id = $1
     ORDER BY created_at, id`,
    [userRows[0].id],
  );
  assert.equal(tokens.length, cap + 1);
  assert.equal(tokens.filter((t) => !t.used).length, cap);
  assert.equal(tokens[0].used, true); // oldest outstanding token was invalidated
});
