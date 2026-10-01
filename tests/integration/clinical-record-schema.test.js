import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import config from '../../src/config.ts';
import { cleanDb } from './helpers/clean-db.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

async function createUser() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [id, `RECORD_${id}`, 'not-a-real-hash', 'admin'],
  );
  return id;
}

async function createPatient() {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO patients
      (id, documento, nombres, apellidos, fecha_nacimiento, email, celular, sexo, direccion)
     VALUES ($1, $2, 'Test', 'Patient', '1990-01-01', 'record@example.com', '123', 'F', 'Test')`,
    [id, id],
  );
  return id;
}

async function createClinicalRecord(patientId, createdBy = null) {
  const { rows } = await pool.query(
    `INSERT INTO clinical_records (patient_id, created_by)
     VALUES ($1, $2) RETURNING id, patient_id, created_by, created_at, updated_by, updated_at`,
    [patientId, createdBy],
  );
  return rows[0];
}

before(async () => {
  await cleanDb(pool);
});

after(async () => {
  try {
    await cleanDb(pool);
  } finally {
    await pool.end();
  }
});

test('clinical record identity is generated and BIGINT values remain lossless strings', async () => {
  const patientId = await createPatient();
  const generated = await createClinicalRecord(patientId);
  assert.match(generated.id, /^\d+$/);

  const explicitId = '9007199254740993';
  const secondPatientId = await createPatient();
  const { rows } = await pool.query(
    'INSERT INTO clinical_records (id, patient_id) VALUES ($1, $2) RETURNING id',
    [explicitId, secondPatientId],
  );
  assert.equal(rows[0].id, explicitId);
  assert.equal(typeof rows[0].id, 'string');
});

test('each record requires an existing patient and allows only one record per patient', async () => {
  const patientId = await createPatient();
  await createClinicalRecord(patientId);

  await assert.rejects(
    pool.query('INSERT INTO clinical_records (patient_id) VALUES (NULL)'),
    (error) => error.code === '23502',
  );
  await assert.rejects(
    pool.query('INSERT INTO clinical_records (patient_id) VALUES ($1)', [randomUUID()]),
    (error) => error.code === '23503',
  );
  await assert.rejects(
    pool.query('INSERT INTO clinical_records (patient_id) VALUES ($1)', [patientId]),
    (error) => error.code === '23505',
  );
});

test('patient deletion is restricted while a clinical record references it', async () => {
  const patientId = await createPatient();
  await createClinicalRecord(patientId);

  await assert.rejects(
    pool.query('DELETE FROM patients WHERE id = $1', [patientId]),
    (error) => error.code === '23503',
  );
});

test('actor UUIDs reference users and timestamps follow nullable update bookkeeping', async () => {
  const userId = await createUser();
  const patientId = await createPatient();
  const record = await createClinicalRecord(patientId, userId);

  assert.equal(record.created_by, userId);
  assert.ok(record.created_at instanceof Date);
  assert.equal(record.updated_by, null);
  assert.equal(record.updated_at, null);

  const secondPatientId = await createPatient();
  await assert.rejects(
    pool.query(
      'INSERT INTO clinical_records (patient_id, created_by) VALUES ($1, $2)',
      [secondPatientId, randomUUID()],
    ),
    (error) => error.code === '23503',
  );

  await assert.rejects(
    pool.query(
      'UPDATE clinical_records SET updated_by = $1 WHERE id = $2',
      [randomUUID(), record.id],
    ),
    (error) => error.code === '23503',
  );
  await pool.query(
    'UPDATE clinical_records SET updated_by = $1, updated_at = now() WHERE id = $2',
    [userId, record.id],
  );
  const { rows } = await pool.query(
    'SELECT updated_by, updated_at FROM clinical_records WHERE id = $1',
    [record.id],
  );
  assert.equal(rows[0].updated_by, userId);
  assert.ok(rows[0].updated_at instanceof Date);
});

test('clinical records have no lifecycle status column', async () => {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'clinical_records'`,
  );
  assert.equal(rows.some(({ column_name }) => column_name === 'status'), false);
});
