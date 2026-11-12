import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { createReceptionPatientRouter } from '../../src/modules/reception/infrastructure/routes/reception-patient.routes.ts';
import { Patient } from '../../src/modules/patients/domain/patient.entity.ts';
import { PgReceptionPatientRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-patient.repository.ts';

const actor = '40000000-0000-4000-8000-000000000001';
const patient = { id: '50000000-0000-4000-8000-000000000001', documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fechaNacimiento: '1990-01-02', fecha_nacimiento: '1990-01-02', email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1', created_by: actor, created_at: '2020-01-01T00:00:00.000Z', updated_by: actor, updated_at: '2024-01-01T00:00:00.000Z', toJSON() { return { id: this.id, documento: this.documento, nombres: this.nombres, apellidos: this.apellidos, fecha_nacimiento: this.fecha_nacimiento, email: this.email, celular: this.celular, sexo: this.sexo, direccion: this.direccion, created_by: this.created_by, created_at: this.created_at }; } };

async function fixture(repository, authenticate) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { userId: actor, role: 'reception', permissions: ['reception:patients:manage'] }; next(); });
  app.use('/reception/patients', createReceptionPatientRouter({ repository, authenticate, getActor: async () => actor }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}/reception/patients`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test('enrolled-patient read locks the patient row inside the active-grant transaction and preserves local DATE parts', async () => {
  let sql;
  const repository = new PgReceptionPatientRepository({});
  const date = new Date(1990, 0, 2);
  const row = { id: patient.id, documento: patient.documento, nombres: patient.nombres, apellidos: patient.apellidos,
    fecha_nacimiento: date, email: patient.email, celular: patient.celular, sexo: patient.sexo, direccion: patient.direccion,
    created_by: null, created_at: new Date(), updated_by: null, updated_at: null };
  const result = await repository.findEnrolled({ async query(text) { sql = text; return { rows: [row] }; } }, patient.id, 'kinesiology');
  assert.match(sql, /JOIN reception_patient_enrollments/);
  assert.match(sql, /FOR UPDATE OF p/);
  assert.equal(result.fechaNacimiento, '1990-01-02');
  assert.equal(result.createdBy, null);
});

test('Reception patient routes deny zero and wrong-career scopes without invoking patient work', async () => {
  const calls = [];
  const repository = {
    async withActiveCareerScope(userId, career, work) {
      calls.push([userId, career]);
      if (career !== 'kinesiology') throw Object.assign(new Error('active career scope was not found'), { statusCode: 404, expose: true });
      return work({});
    },
    async list() { return [patient]; },
  };
  const http = await fixture(repository);
  try {
    const none = await fetch(`${http.base}?career=odontology`);
    assert.equal(none.status, 404);
    assert.deepEqual(calls, [[actor, 'odontology']]);
    calls.length = 0;
    const match = await fetch(`${http.base}/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'odontology', documento: patient.documento }) });
    assert.equal(match.status, 404);
    assert.deepEqual(calls, [[actor, 'odontology']]);
  } finally { await http.close(); }
});

test('Reception exact-document match exposes only confirmation/reference and reuse enrolls without overwrite', async () => {
  const calls = [];
  const repository = {
    async withActiveCareerScope(userId, career, work) { calls.push(['scope', userId, career]); return work({}); },
    async matchByDocumento(_db, documento) { calls.push(['match', documento]); return { id: patient.id }; },
    async enrollExisting(_db, id, career) { calls.push(['enroll', id, career]); return { id }; },
    async list() { return []; },
  };
  const http = await fixture(repository);
  try {
    const result = await fetch(`${http.base}/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology', documento: patient.documento }) });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { match: true, patient_id: patient.id });
    const reused = await fetch(`${http.base}/reuse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology', patient_id: patient.id, documento: patient.documento }) });
    assert.equal(reused.status, 200);
    assert.deepEqual(await reused.json(), { patient_id: patient.id, career: 'kinesiology', enrolled: true });
    assert.deepEqual(calls.map(call => call[0]), ['scope', 'match', 'scope', 'match', 'enroll']);
  } finally { await http.close(); }
});

test('registration reuses patient validation, binds creator to verified actor, and emits no audit metadata', async () => {
  const calls = [];
  const repository = {
    async withActiveCareerScope(_userId, career, work) { calls.push(['scope', career]); return work({}); },
    async matchByDocumento() { return null; },
    async findPatientByDocumento() { return null; },
    async createAndEnroll(_db, value, career) {
      calls.push(['create', value.createdBy, career, value.documento]);
      return new Patient({ id: patient.id, documento: value.documento, nombres: value.nombres, apellidos: value.apellidos,
        fechaNacimiento: value.fechaNacimiento, email: value.email, celular: value.celular, sexo: value.sexo, direccion: value.direccion,
        createdBy: actor, createdAt: new Date(), updatedBy: null, updatedAt: null });
    },
  };
  const http = await fixture(repository);
  try {
    const response = await fetch(`${http.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ career: 'kinesiology', documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02', email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1' }) });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['id','documento','nombres','apellidos','fecha_nacimiento','email','celular','sexo','direccion'].sort());
    assert.deepEqual(calls, [['scope', 'kinesiology'], ['create', actor, 'kinesiology', '35123456']]);
  } finally { await http.close(); }
});

test('registration rejects malformed patient field types before repository reads or writes', async () => {
  const calls = [];
  const repository = {
    async withActiveCareerScope(_userId, career, work) { calls.push(['scope', career]); return work({}); },
    async findPatientByDocumento() { calls.push(['find']); return null; },
    async createAndEnroll(_db, value) { calls.push(['create', value]); return new Patient({ ...value, id: patient.id }); },
  };
  const http = await fixture(repository);
  const valid = { career: 'kinesiology', documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02', email: 'ana@example.com', celular: '123', sexo: 'F', direccion: 'Calle 1' };
  try {
    const malformedBody = await fetch(`${http.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' });
    assert.equal(malformedBody.status, 400);
    assert.deepEqual(await malformedBody.json(), { error: { code: 'BAD_REQUEST', message: 'patient body must be an object' } });
    const missingValue = await fetch(`${http.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...valid, nombres: null }) });
    assert.equal(missingValue.status, 400);
    assert.deepEqual(await missingValue.json(), { error: { code: 'BAD_REQUEST', message: 'nombres is required' } });
    for (const field of ['nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion']) {
      for (const value of [42, { malformed: true }]) {
        const response = await fetch(`${http.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...valid, [field]: value }) });
        assert.equal(response.status, 400, `${field} must reject ${typeof value}`);
        assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: `${field} must be a string` } });
      }
    }
    const malformedDocumento = await fetch(`${http.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...valid, documento: { digits: '35123456' } }) });
    assert.equal(malformedDocumento.status, 400);
    assert.deepEqual(await malformedDocumento.json(), { error: { code: 'BAD_REQUEST', message: 'documento must be a string or number' } });
    const validNumber = await fetch(`${http.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...valid, documento: 35123457 }) });
    assert.equal(validNumber.status, 201);
    assert.equal((await validNumber.json()).documento, '35123457');
    assert.equal(calls.filter(call => call[0] === 'create').length, 1);
    assert.equal(calls.filter(call => call[0] === 'find').length, 1);
  } finally { await http.close(); }
});

test('missing Reception patient permission rejects before any career-scope work', async () => {
  let scopes = 0;
  const repository = { async withActiveCareerScope(_userId, _career, work) { scopes += 1; return work({}); } };
  const authenticate = (req, _res, next) => { req.auth = { userId: actor, role: 'reception', permissions: ['reception:careers:read'] }; next(); };
  const http = await fixture(repository, authenticate);
  try {
    const denied = await fetch(`${http.base}?career=kinesiology`);
    assert.equal(denied.status, 403);
    assert.equal(scopes, 0);
  } finally { await http.close(); }
});

test('authentication runs on matched patient handlers, not unmatched route prefixes', async () => {
  let authCalls = 0;
  const repository = {
    async withActiveCareerScope(_userId, _career, work) { return work({}); },
    async matchByDocumento() { return null; },
  };
  const authenticate = (req, _res, next) => {
    authCalls += 1;
    req.auth = { userId: actor, role: 'reception', permissions: ['reception:patients:manage'] };
    next();
  };
  const http = await fixture(repository, authenticate);
  try {
    const unknown = await fetch(`${http.base}/not-a-route/extra`);
    assert.equal(unknown.status, 404);
    assert.equal(authCalls, 0);
    const match = await fetch(`${http.base}/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology', documento: '35123456' }) });
    assert.equal(match.status, 200);
    assert.equal(authCalls, 1);
  } finally { await http.close(); }
});

test('Reception list/read require persistent enrollment and contact updates cannot write identity fields', async () => {
  const calls = [];
  const repository = {
    async withActiveCareerScope(userId, career, work) { calls.push(['scope', userId, career]); return work({}); },
    async list(_db, career) { calls.push(['list', career]); return [patient]; },
    async findEnrolled(_db, id, career) { calls.push(['read', id, career]); return id === patient.id ? patient : null; },
    async updateContact(_db, id, career, input) { calls.push(['update', id, career, input]); return { ...patient, ...input }; },
  };
  const http = await fixture(repository);
  try {
    const listed = await fetch(`${http.base}?career=kinesiology`);
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { items: [{ id: patient.id, documento: patient.documento, nombres: patient.nombres, apellidos: patient.apellidos, fecha_nacimiento: patient.fecha_nacimiento, email: patient.email, celular: patient.celular, sexo: patient.sexo, direccion: patient.direccion }], limit: 100, offset: 0 });
    const read = await fetch(`${http.base}/${patient.id}?career=kinesiology`);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { id: patient.id, documento: patient.documento, nombres: patient.nombres, apellidos: patient.apellidos, fecha_nacimiento: patient.fecha_nacimiento, email: patient.email, celular: patient.celular, sexo: patient.sexo, direccion: patient.direccion });
    const rejected = await fetch(`${http.base}/${patient.id}?career=kinesiology`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombres: 'Changed', celular: '999' }) });
    assert.equal(rejected.status, 400);
    const invalidContact = await fetch(`${http.base}/${patient.id}?career=kinesiology`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'not-email' }) });
    assert.equal(invalidContact.status, 400);
    const blankContact = await fetch(`${http.base}/${patient.id}?career=kinesiology`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ celular: '  ' }) });
    assert.equal(blankContact.status, 400);
    const validContact = await fetch(`${http.base}/${patient.id}?career=kinesiology`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ celular: '456' }) });
    assert.equal(validContact.status, 200);
    assert.deepEqual(calls.filter(call => call[0] === 'update'), [['update', patient.id, 'kinesiology', { email: patient.email, celular: '456', direccion: patient.direccion }]]);
  } finally { await http.close(); }
});
