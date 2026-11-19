import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { CreatePatient } from '../../src/modules/patients/application/create-patient.usecase.ts';
import { Patient } from '../../src/modules/patients/domain/patient.entity.ts';
import { createPatientRouter } from '../../src/modules/patients/infrastructure/routes/patient.routes.ts';
import { PgPatientRepository } from '../../src/modules/patients/infrastructure/repositories/pg-patient.repository.ts';
import { createReceptionPatientRouter } from '../../src/modules/reception/infrastructure/routes/reception-patient.routes.ts';
import { PgReceptionPatientRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-patient.repository.ts';

const actor = '40000000-0000-4000-8000-000000000001';
const patientId = '50000000-0000-4000-8000-000000000001';
const MARITAL = 'marital_status must be single, married, divorced, widowed, civil_union or null';
const INSURANCE = 'medical_insurance must be ips, police_health, military_health, none or null';
const valid = { documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02',
  email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1' };
const bad = (message) => ({ error: { code: 'BAD_REQUEST', message } });

function stored(overrides = {}) {
  return new Patient({ id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fechaNacimiento: '1990-01-02',
    email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1', createdBy: actor,
    createdAt: '2020-01-01T00:00:00.000Z', ...overrides });
}

async function serve(mount, auth) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = auth; next(); });
  mount(app);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { call, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('patient creation stores optional marital status and medical insurance and rejects other values before any lookup', async () => {
  const calls = [];
  const useCase = new CreatePatient({ repository: {
    async findByDocumento(documento) { calls.push(['find', documento]); return null; },
    async create(patient) { calls.push(['create', patient.maritalStatus, patient.medicalInsurance]); return patient; },
  } });
  const omitted = await useCase.execute(valid);
  assert.equal(omitted.toJSON().marital_status, null);
  assert.equal(omitted.toJSON().medical_insurance, null);
  for (const marital of ['single', 'married', 'divorced', 'widowed', 'civil_union', null]) {
    for (const insurance of ['ips', 'police_health', 'military_health', 'none', null]) {
      const created = await useCase.execute({ ...valid, marital_status: marital, medical_insurance: insurance });
      assert.equal(created.toJSON().marital_status, marital);
      assert.equal(created.toJSON().medical_insurance, insurance);
    }
  }
  calls.length = 0;
  for (const value of ['Single', 'soltero', '', 1, true, {}, []]) {
    await assert.rejects(useCase.execute({ ...valid, marital_status: value }), { statusCode: 400, message: MARITAL });
    await assert.rejects(useCase.execute({ ...valid, medical_insurance: value }), { statusCode: 400, message: INSURANCE });
  }
  assert.deepEqual(calls, []);
});

test('patient serialization exposes exactly the 13 contract keys, the two new ones null by default', () => {
  assert.deepEqual(Object.keys(stored().toJSON()), ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email',
    'celular', 'sexo', 'direccion', 'marital_status', 'medical_insurance', 'created_by', 'created_at']);
  assert.equal(stored().toJSON().marital_status, null);
  assert.equal(stored({ maritalStatus: 'married', medicalInsurance: 'ips' }).toJSON().medical_insurance, 'ips');
});

test('pg patient repository writes and reads the two columns and patches only the sent fields with audit columns', async () => {
  const queries = [];
  const row = { id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02',
    email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1', marital_status: 'married', medical_insurance: null,
    created_by: actor, created_at: '2020-01-01', updated_by: actor, updated_at: '2020-01-02' };
  let rows = [row];
  const repository = new PgPatientRepository({ async query(text, params) { queries.push([text, params]); return { rows }; } });
  const created = await repository.create(Patient.create({ ...valid, fechaNacimiento: valid.fecha_nacimiento, maritalStatus: 'married', medicalInsurance: null }));
  assert.match(queries[0][0], /marital_status, medical_insurance/);
  assert.ok(queries[0][1].includes('married'));
  assert.equal(created.maritalStatus, 'married');
  assert.equal(created.medicalInsurance, null);
  queries.length = 0;
  const updated = await repository.updatePersonalData(patientId, { maritalStatus: 'married' }, actor);
  const [sql, params] = queries[0];
  assert.match(sql, /UPDATE patients/);
  assert.match(sql, /updated_by = \$6/);
  assert.match(sql, /updated_at = clock_timestamp\(\)/);
  assert.deepEqual(params, [patientId, true, 'married', false, null, actor]);
  assert.equal(updated.maritalStatus, 'married');
  rows = [];
  assert.equal(await repository.updatePersonalData(patientId, { medicalInsurance: null }, actor), null);
  assert.deepEqual(queries[1][1], [patientId, false, null, true, null, actor]);
});

test('admin PATCH /patients/:id updates only marital status and medical insurance', async () => {
  const calls = [];
  const repository = {
    async findByDocumento() { return null; },
    async create(value) { return value; },
    async updatePersonalData(id, patch, actorId) {
      calls.push([id, patch, actorId]);
      return id === patientId ? stored({ maritalStatus: patch.maritalStatus ?? null, medicalInsurance: patch.medicalInsurance ?? null }) : null;
    },
  };
  const mount = (app) => app.use('/patients', createPatientRouter({ repository, personalDataRepository: repository,
    guard: { async authorize(req) { if (!req.auth.permissions.includes('patients:write')) throw Object.assign(new Error("Permission 'patients:write' required"), { statusCode: 403, expose: true }); } } }));
  const admin = await serve(mount, { userId: actor, role: 'admin', permissions: ['patients:write'] });
  try {
    const both = await admin.call(`/patients/${patientId}`, 'PATCH', { marital_status: 'widowed', medical_insurance: 'none' });
    assert.equal(both.status, 200);
    assert.deepEqual(Object.keys(both.body), ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email',
      'celular', 'sexo', 'direccion', 'marital_status', 'medical_insurance', 'created_by', 'created_at']);
    assert.equal(both.body.marital_status, 'widowed');
    assert.equal(both.body.medical_insurance, 'none');
    const cleared = await admin.call(`/patients/${patientId}`, 'PATCH', { medical_insurance: null });
    assert.equal(cleared.status, 200);
    assert.deepEqual(calls, [[patientId, { maritalStatus: 'widowed', medicalInsurance: 'none' }, actor], [patientId, { medicalInsurance: null }, actor]]);
    calls.length = 0;
    const rejected = [
      [`/patients/${patientId}`, { nombres: 'Changed' }, 'allowed fields: marital_status, medical_insurance'],
      [`/patients/${patientId}`, { marital_status: 'single', email: 'x@example.com' }, 'allowed fields: marital_status, medical_insurance'],
      [`/patients/${patientId}`, {}, 'at least one of marital_status or medical_insurance is required'],
      [`/patients/${patientId}`, [], 'body must be an object'],
      [`/patients/${patientId}`, { marital_status: 'soltero' }, MARITAL],
      [`/patients/${patientId}`, { medical_insurance: 'IPS' }, INSURANCE],
      ['/patients/not-a-uuid', { marital_status: 'single' }, 'id must be a UUID'],
    ];
    for (const [path, body, message] of rejected) {
      const response = await admin.call(path, 'PATCH', body);
      assert.equal(response.status, 400, message);
      assert.deepEqual(response.body, bad(message));
    }
    const unknown = await admin.call('/patients/50000000-0000-4000-8000-000000000009', 'PATCH', { marital_status: 'single' });
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { error: { code: 'NOT_FOUND', message: 'patient was not found' } });
    assert.equal(calls.length, 1);
  } finally { await admin.close(); }
  calls.length = 0;
  for (const auth of [{ userId: actor, role: 'teacher', permissions: ['patients:write'] }, { userId: actor, role: 'admin', permissions: [] }]) {
    const denied = await serve(mount, auth);
    try {
      const response = await denied.call(`/patients/${patientId}`, 'PATCH', { marital_status: 'single' });
      assert.equal(response.status, 403);
    } finally { await denied.close(); }
  }
  assert.deepEqual(calls, []);
});

test('admin GET /patients and Reception projections include the two fields', async () => {
  const patient = stored({ maritalStatus: 'single', medicalInsurance: 'ips' });
  const admin = await serve((app) => app.use('/patients', createPatientRouter({ repository: {}, listRepository: { async list() { return [patient]; } } })),
    { userId: actor, role: 'admin', permissions: [] });
  try {
    const listed = await admin.call('/patients');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.items, [{ id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02',
      email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1', marital_status: 'single', medical_insurance: 'ips' }]);
  } finally { await admin.close(); }
});

function receptionRepository(calls, current = stored()) {
  return {
    async withActiveCareerScope(_userId, _career, work) { return work({}); },
    async findPatientByDocumento() { return null; },
    async createAndEnroll(_db, value) { calls.push(['create', value.maritalStatus, value.medicalInsurance]); return new Patient({ ...value, id: patientId }); },
    async findEnrolled(_db, id) { calls.push(['read', id]); return current; },
    async updateContact(_db, id, career, input) { calls.push(['update', id, career, input]);
      return stored({ email: input.email, celular: input.celular, direccion: input.direccion, maritalStatus: input.maritalStatus, medicalInsurance: input.medicalInsurance }); },
  };
}

test('Reception registration accepts the two optional fields, returns them and rejects invalid values before writing', async () => {
  const calls = [];
  const reception = await serve((app) => app.use('/reception/patients', createReceptionPatientRouter({ repository: receptionRepository(calls), getActor: async () => actor })),
    { userId: actor, role: 'reception', permissions: ['reception:patients:manage'] });
  try {
    const registered = await reception.call('/reception/patients/register', 'POST', { career: 'odontology', ...valid, marital_status: 'civil_union', medical_insurance: 'military_health' });
    assert.equal(registered.status, 201);
    assert.deepEqual(registered.body, { id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02',
      email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1', marital_status: 'civil_union', medical_insurance: 'military_health' });
    const omitted = await reception.call('/reception/patients/register', 'POST', { career: 'odontology', ...valid });
    assert.equal(omitted.status, 201);
    assert.equal(omitted.body.marital_status, null);
    assert.equal(omitted.body.medical_insurance, null);
    assert.deepEqual(calls, [['create', 'civil_union', 'military_health'], ['create', null, null]]);
    calls.length = 0;
    const invalidMarital = await reception.call('/reception/patients/register', 'POST', { career: 'odontology', ...valid, marital_status: 'casado' });
    assert.equal(invalidMarital.status, 400);
    assert.deepEqual(invalidMarital.body, bad(MARITAL));
    const invalidInsurance = await reception.call('/reception/patients/register', 'POST', { career: 'odontology', ...valid, medical_insurance: 'private' });
    assert.equal(invalidInsurance.status, 400);
    assert.deepEqual(invalidInsurance.body, bad(INSURANCE));
    assert.deepEqual(calls, []);
  } finally { await reception.close(); }
});

test('Reception PATCH edits the two fields with contact fields, keeps omitted values and rejects identity fields', async () => {
  const calls = [];
  const current = stored({ maritalStatus: 'single', medicalInsurance: 'ips' });
  const reception = await serve((app) => app.use('/reception/patients', createReceptionPatientRouter({ repository: receptionRepository(calls, current), getActor: async () => actor })),
    { userId: actor, role: 'reception', permissions: ['reception:patients:manage'] });
  const path = `/reception/patients/${patientId}?career=odontology`;
  try {
    const married = await reception.call(path, 'PATCH', { marital_status: 'married' });
    assert.equal(married.status, 200);
    assert.equal(married.body.marital_status, 'married');
    assert.equal(married.body.medical_insurance, 'ips');
    const cleared = await reception.call(path, 'PATCH', { celular: '456', medical_insurance: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.medical_insurance, null);
    assert.deepEqual(calls.filter(call => call[0] === 'update'), [
      ['update', patientId, 'odontology', { email: 'ana@example.com', celular: '123', direccion: 'Calle 1', maritalStatus: 'married', medicalInsurance: 'ips' }],
      ['update', patientId, 'odontology', { email: 'ana@example.com', celular: '456', direccion: 'Calle 1', maritalStatus: 'single', medicalInsurance: null }],
    ]);
    calls.length = 0;
    const rejected = [
      [{ nombres: 'Changed' }, 'only email, celular, direccion, marital_status and medical_insurance may be updated'],
      [{ marital_status: 'divorciado' }, MARITAL],
      [{ medical_insurance: 3 }, INSURANCE],
      [{ celular: null }, 'contact fields must be strings'],
      [{}, 'contact fields must be strings'],
    ];
    for (const [body, message] of rejected) {
      const response = await reception.call(path, 'PATCH', body);
      assert.equal(response.status, 400, message);
      assert.deepEqual(response.body, bad(message));
    }
    assert.deepEqual(calls.filter(call => call[0] === 'update'), []);
  } finally { await reception.close(); }
});

test('pg Reception repository inserts, selects and updates the two columns', async () => {
  const queries = [];
  const row = { id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02',
    email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1', marital_status: 'widowed', medical_insurance: 'none',
    created_by: actor, created_at: '2020-01-01', updated_by: null, updated_at: null };
  const repository = new PgReceptionPatientRepository({});
  const db = { async query(text, params) { queries.push([text, params]); return { rows: [row] }; } };
  const created = await repository.createAndEnroll(db, Patient.create({ ...valid, fechaNacimiento: valid.fecha_nacimiento, maritalStatus: 'widowed', medicalInsurance: 'none' }), 'odontology');
  assert.match(queries[0][0], /marital_status,medical_insurance/);
  assert.deepEqual(queries[0][1].slice(-2), ['widowed', 'none']);
  assert.equal(created.maritalStatus, 'widowed');
  queries.length = 0;
  const read = await repository.findEnrolled(db, patientId, 'odontology');
  assert.match(queries[0][0], /p\.marital_status, p\.medical_insurance/);
  assert.equal(read.medicalInsurance, 'none');
  queries.length = 0;
  await repository.updateContact(db, patientId, 'odontology', { email: 'a@example.com', celular: '1', direccion: 'd', maritalStatus: 'single', medicalInsurance: null }, actor);
  assert.match(queries[0][0], /marital_status=\$6,medical_insurance=\$7,updated_by=\$8/);
  assert.deepEqual(queries[0][1], [patientId, 'odontology', 'a@example.com', '1', 'd', 'single', null, actor]);
});
