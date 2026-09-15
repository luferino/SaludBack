import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import config from '../../src/config.ts';
import { createPatientRouter } from '../../src/modules/patients/infrastructure/routes/patient.routes.ts';
import { PgPatientRepository } from '../../src/modules/patients/infrastructure/repositories/pg-patient.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.ts';
import { AdminGuard } from '../../src/modules/shared/application/guard.ts';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { cleanDb } from './helpers/clean-db.js';
import { seedAdmin, tokenForRole } from './helpers/admin-token.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const CONTRACT_KEYS = [
  'id',
  'documento',
  'nombres',
  'apellidos',
  'fecha_nacimiento',
  'email',
  'celular',
  'sexo',
  'direccion',
  'created_by',
  'created_at',
];

const VALID_PAYLOAD = {
  documento: '35123456',
  nombres: 'Ana',
  apellidos: 'Lopez',
  fecha_nacimiento: '1990-04-12',
  email: 'ana@mail.com',
  celular: '+5491100000000',
  sexo: 'F',
  direccion: 'Av. Siempre Viva 742',
};

/**
 * Production-like stack: authenticate (populates req.auth) then the router,
 * whose handler runs AdminGuard and resolves created_by from the token sub.
 */
function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/patients',
    authenticate(new JwtTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn })),
    createPatientRouter({
      repository: overrides.repository ?? new PgPatientRepository(pool),
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

async function createPatient(payload, options = {}) {
  const res = await fetch(`${baseUrl}/patients`, {
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

async function countPatients(documento) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM patients WHERE documento = $1',
    [documento],
  );
  return rows[0].n;
}

/**
 * Wraps the real patient repository so the pre-check lookup hits the DB
 * (returning null for a fresh documento) but create() raises a raw pg
 * unique_violation (SQLSTATE 23505) — deterministically simulating the
 * TOCTOU race a duplicate can slip through. The endpoint must translate
 * it to 409, never leak it as a 500.
 */
function racingPatientRepository(constraint, message) {
  const real = new PgPatientRepository(pool);
  const leak = new Error(message);
  leak.code = '23505';
  leak.constraint = constraint;
  return {
    findByDocumento: (documento) => real.findByDocumento(documento),
    create: async () => {
      throw leak;
    },
  };
}

test('POST /patients rejects a missing, garbage and non-admin token (401/401/403)', async () => {
  const payload = { ...VALID_PAYLOAD, documento: '87654321' };

  const noToken = await fetch(`${baseUrl}/patients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(noToken.status, 401);

  const garbage = await fetch(`${baseUrl}/patients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer not.a.jwt' },
    body: JSON.stringify(payload),
  });
  assert.equal(garbage.status, 401);

  const nonAdmin = await fetch(`${baseUrl}/patients`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await tokenForRole('teacher')}`,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(nonAdmin.status, 403);
  assert.equal((await nonAdmin.json()).error.code, 'FORBIDDEN');

  assert.equal(await countPatients('87654321'), 0, 'guard rejection persists nothing');
});

test('POST /patients creates a patient with the exact 11-key contract body', async () => {
  const { status, body } = await createPatient(VALID_PAYLOAD);

  assert.equal(status, 201);
  assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
  assert.equal(body.documento, '35123456');
  assert.equal(body.nombres, 'Ana');
  assert.equal(body.fecha_nacimiento, '1990-04-12');
  assert.equal(body.created_by, adminId, 'admin token sub lands in created_by (PAT-004)');
  assert.equal(typeof body.id, 'string');
  assert.equal(typeof body.created_at, 'string');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM patients WHERE documento = $1',
    ['35123456'],
  );
  assert.equal(rows[0].n, 1);
});

test('POST /patients rejects a duplicate documento with 409 and keeps one row', async () => {
  await createPatient({ ...VALID_PAYLOAD, documento: '22222222' });
  const { status, body } = await createPatient({ ...VALID_PAYLOAD, documento: '22222222' });

  assert.equal(status, 409);
  assert.equal(body.error.code, 'CONFLICT');
  assert.equal(await countPatients('22222222'), 1);
});

test('POST /patients rejects missing, null, blank, or invalid fields with 400 and persists nothing', async () => {
  const base = { ...VALID_PAYLOAD, documento: '77776666' };
  const payloads = [];
  for (const field of Object.keys(base)) {
    const { [field]: _omitted, ...missing } = base;
    payloads.push(missing, { ...base, [field]: null }, { ...base, [field]: '   ' });
  }
  payloads.push(
    { ...base, documento: '12A4' },
    { ...base, documento: '123' },
    { ...base, documento: '123456789' },
    { ...base, sexo: 'm' },
    { ...base, fecha_nacimiento: '2026-02-31' },
    { ...base, fecha_nacimiento: '2999-01-01' },
    { ...base, email: 'not-an-email' },
  );

  for (const payload of payloads) {
    const { status, body } = await createPatient(payload);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(body.error.code, 'BAD_REQUEST');
  }

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM patients WHERE documento = $1',
    ['77776666'],
  );
  assert.equal(rows[0].n, 0);
});

test('POST /patients maps a unique-violation race on the documento insert to 409 CONFLICT, not 500', async () => {
  const app = buildApp({
    repository: racingPatientRepository(
      'patients_documento_key',
      'duplicate key value violates unique constraint "patients_documento_key"',
    ),
  });
  const racingServer = app.listen(0);
  await new Promise((resolve) => racingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${racingServer.address().port}`;

  try {
    const res = await fetch(`${url}/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ ...VALID_PAYLOAD, documento: '58585858' }),
    });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.error.code, 'CONFLICT');
    assert.equal(body.error.message, 'documento already exists: 58585858');
    assert.equal(await countPatients('58585858'), 0, 'the race persists no patient');
  } finally {
    // closeAllConnections destroys the undici keep-alive socket, otherwise
    // close() waits on it and the test runner hangs at teardown.
    await new Promise((resolve) => {
      racingServer.close(resolve);
      racingServer.closeAllConnections();
    });
  }
});