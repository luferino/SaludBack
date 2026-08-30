import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import config from '../../src/config.ts';
import { createPatientRouter } from '../../src/modules/patients/infrastructure/routes/patient.routes.ts';
import { PgPatientRepository } from '../../src/modules/patients/infrastructure/repositories/pg-patient.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { Guard } from '../../src/modules/shared/application/guard.ts';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';

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

function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/patients',
    createPatientRouter({
      repository: new PgPatientRepository(pool),
      ...overrides,
    }),
  );
  app.use(errorHandler);
  return app;
}

let server;
let baseUrl;

before(async () => {
  await pool.query('DELETE FROM patients');
  server = buildApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function createPatient(payload, options = {}) {
  const res = await fetch(`${baseUrl}/patients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
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

test('POST /patients creates a patient with the exact 11-key contract body', async () => {
  const { status, body } = await createPatient(VALID_PAYLOAD);

  assert.equal(status, 201);
  assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
  assert.equal(body.documento, '35123456');
  assert.equal(body.nombres, 'Ana');
  assert.equal(body.fecha_nacimiento, '1990-04-12');
  assert.equal(body.created_by, null);
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

test('an attached guard rejects the request before the use case runs', async () => {
  class AdminGuard extends Guard {
    async authorize() {
      throw new UnauthorizedError();
    }
  }

  const guardedServer = buildApp({ guard: new AdminGuard() }).listen(0);
  await new Promise((resolve) => guardedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${guardedServer.address().port}`;

  const res = await fetch(`${url}/patients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...VALID_PAYLOAD, documento: '33333333' }),
  });
  assert.equal(res.status, 401);

  await new Promise((resolve) => guardedServer.close(resolve));
  assert.equal(await countPatients('33333333'), 0);
});

test('a stub middleware exposing req.auth.sub populates created_by (PAT-004 verified token)', async () => {
  const actorId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  await pool.query('DELETE FROM users WHERE id = $1', [actorId]);
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [actorId, 'smoke-doctor', 'not-a-real-hash', 'admin'],
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { sub: actorId };
    next();
  });
  app.use('/patients', createPatientRouter({ repository: new PgPatientRepository(pool) }));
  app.use(errorHandler);

  const actorServer = app.listen(0);
  await new Promise((resolve) => actorServer.once('listening', resolve));
  const url = `http://127.0.0.1:${actorServer.address().port}`;

  try {
    const res = await fetch(`${url}/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_PAYLOAD, documento: '44444444' }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.created_by, actorId);

    const { rows } = await pool.query(
      'SELECT created_by FROM patients WHERE documento = $1',
      ['44444444'],
    );
    assert.equal(rows[0].created_by, actorId);
  } finally {
    // Always release the server handle and clean up the actor FK rows, even
    // when an assertion throws, so the node:test process cannot hang on an
    // open handle and the auth suite's DELETE FROM users never races this
    // patient row and trips the FK constraint.
    await new Promise((resolve) => actorServer.close(resolve));
    await pool.query('DELETE FROM patients WHERE created_by = $1', [actorId]);
    await pool.query('DELETE FROM users WHERE id = $1', [actorId]);
  }
});

test('a garbage Bearer token on the open route still creates with created_by null', async () => {
  const { status, body } = await createPatient(
    { ...VALID_PAYLOAD, documento: '55555555' },
    { headers: { authorization: 'Bearer not.a.jwt' } },
  );

  assert.equal(status, 201);
  assert.equal(body.created_by, null);

  const { rows } = await pool.query(
    'SELECT created_by FROM patients WHERE documento = $1',
    ['55555555'],
  );
  assert.equal(rows[0].created_by, null);
});
