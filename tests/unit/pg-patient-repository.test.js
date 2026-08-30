import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgPatientRepository } from '../../src/modules/patients/infrastructure/repositories/pg-patient.repository.ts';
import { Patient } from '../../src/modules/patients/domain/patient.entity.ts';

function createFakePool(queryHandler) {
  return { query: queryHandler };
}

const CREATED_AT = new Date('2026-08-10T12:00:00Z');
// pg parses DATE columns as a JS Date at local midnight; simulate that here.
const FECHA_NACIMIENTO = new Date(1990, 3, 12);

function patientRow(overrides = {}) {
  return {
    id: 'uuid-1',
    documento: '35123456',
    nombres: 'Ana',
    apellidos: 'Lopez',
    fecha_nacimiento: FECHA_NACIMIENTO,
    email: 'ana@mail.com',
    celular: '+5491100000000',
    sexo: 'F',
    direccion: 'Av. Siempre Viva 742',
    created_by: null,
    created_at: CREATED_AT,
    updated_by: null,
    updated_at: null,
    ...overrides,
  };
}

test('findByDocumento returns null when no patient matches', async () => {
  const repo = new PgPatientRepository(createFakePool(async () => ({ rows: [] })));
  assert.equal(await repo.findByDocumento('99999999'), null);
});

test('findByDocumento queries by documento and maps a row to a Patient', async () => {
  const repo = new PgPatientRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /FROM patients WHERE documento = \$\d+/);
      assert.deepEqual(params, ['35123456']);
      return { rows: [patientRow()] };
    }),
  );

  const patient = await repo.findByDocumento('35123456');
  assert.ok(patient instanceof Patient);
  assert.equal(patient.id, 'uuid-1');
  assert.equal(patient.documento, '35123456');
  assert.equal(patient.nombres, 'Ana');
  assert.equal(patient.apellidos, 'Lopez');
  assert.equal(patient.fechaNacimiento, '1990-04-12');
  assert.equal(patient.email, 'ana@mail.com');
  assert.equal(patient.celular, '+5491100000000');
  assert.equal(patient.sexo, 'F');
  assert.equal(patient.direccion, 'Av. Siempre Viva 742');
  assert.equal(patient.createdBy, null);
  assert.equal(patient.createdAt, CREATED_AT);
  assert.equal(patient.updatedBy, null, 'creation leaves updated_by NULL (PAT-007)');
  assert.equal(patient.updatedAt, null, 'creation leaves updated_at NULL (PAT-007)');
});

test('create inserts the patient and returns the persisted entity', async () => {
  const repo = new PgPatientRepository(
    createFakePool(async (text, params) => {
      assert.match(text, /INSERT INTO patients/);
      assert.deepEqual(params, [
        '35123456',
        'Ana',
        'Lopez',
        '1990-04-12',
        'ana@mail.com',
        '+5491100000000',
        'F',
        'Av. Siempre Viva 742',
        null,
        null,
        null,
      ]);
      return { rows: [patientRow({ id: 'uuid-2', created_by: 'actor-1' })] };
    }),
  );

  const patient = await repo.create(
    new Patient({
      documento: '35123456',
      nombres: 'Ana',
      apellidos: 'Lopez',
      fechaNacimiento: '1990-04-12',
      email: 'ana@mail.com',
      celular: '+5491100000000',
      sexo: 'F',
      direccion: 'Av. Siempre Viva 742',
      createdBy: null,
    }),
  );
  assert.equal(patient.id, 'uuid-2');
  assert.equal(patient.documento, '35123456');
  assert.equal(patient.createdBy, 'actor-1');
  assert.equal(patient.createdAt, CREATED_AT);
});

test('toJSON returns exactly the 11 PAT-006 contract keys with a normalized date', () => {
  const patient = new Patient({
    id: 'uuid-3',
    documento: '00123456',
    nombres: 'Luis',
    apellidos: 'Perez',
    fechaNacimiento: FECHA_NACIMIENTO,
    email: 'luis@mail.com',
    celular: '+5491100000001',
    sexo: 'M',
    direccion: 'Calle Falsa 123',
    createdBy: null,
    createdAt: CREATED_AT,
    updatedBy: 'actor-9',
    updatedAt: new Date('2026-08-12T12:00:00Z'),
  });

  const json = patient.toJSON();
  assert.deepEqual(Object.keys(json).sort(), [
    'apellidos',
    'celular',
    'created_at',
    'created_by',
    'direccion',
    'documento',
    'email',
    'fecha_nacimiento',
    'id',
    'nombres',
    'sexo',
  ]);
  assert.equal(json.created_by, null);
  assert.equal(json.fecha_nacimiento, '1990-04-12');
  // AUD-002: update audit is internal and never serialized.
  assert.equal('updated_by' in json, false);
  assert.equal('updated_at' in json, false);
});
