import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { createPatientRouter } from '../../src/modules/patients/infrastructure/routes/patient.routes.ts';

const actor = '40000000-0000-4000-8000-000000000001';
const patientId = '50000000-0000-4000-8000-000000000001';
const unknownId = '50000000-0000-4000-8000-000000000009';
const READ = 'patient-personal-data:read';
const WRITE = 'patient-personal-data:write';
const MARITAL = 'marital_status must be single, married, divorced, widowed, civil_union or null';
const INSURANCE = 'medical_insurance must be ips, police_health, military_health, none or null';
const PATCH_FIELDS = 'allowed fields: marital_status, medical_insurance';
const PATCH_REQUIRED = 'at least one of marital_status or medical_insurance is required';
const VIEW_KEYS = ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'sexo', 'direccion', 'marital_status', 'medical_insurance'];
const VIEW = { id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02',
  sexo: 'F', direccion: 'Calle 1', marital_status: 'single', medical_insurance: 'ips' };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'patient was not found' } };
const bad = (message) => ({ error: { code: 'BAD_REQUEST', message } });
const forbidden = (message) => ({ error: { code: 'FORBIDDEN', message } });
const unauthorized = (message) => ({ error: { code: 'UNAUTHORIZED', message } });

// Application-level personal-data record returned by the access repository (camelCase, nine fields).
function record(overrides = {}) {
  return { id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fechaNacimiento: '1990-01-02',
    sexo: 'F', direccion: 'Calle 1', maritalStatus: 'single', medicalInsurance: 'ips', ...overrides };
}

async function serve(mount, auth) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (auth !== undefined) req.auth = auth; next(); });
  mount(app);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  return { call, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

// Fake access repository: records every call and answers only for `patientId`, like an access-denied or unknown patient would.
function fakeAccess(calls, current = record()) {
  return {
    async readPersonalData(id, who) {
      calls.push(['read', id, who]);
      return id === patientId ? current : null;
    },
    async updateAsStudent(id, patch, who) {
      calls.push(['update', id, patch, who]);
      if (id !== patientId) return null;
      return {
        ...current,
        maritalStatus: patch.maritalStatus !== undefined ? patch.maritalStatus : current.maritalStatus,
        medicalInsurance: patch.medicalInsurance !== undefined ? patch.medicalInsurance : current.medicalInsurance,
      };
    },
  };
}

function mountWith(calls, current) {
  const repository = { async findByDocumento() { return null; }, async create(value) { return value; } };
  return (app) => app.use('/patients', createPatientRouter({ repository, personalDataAccessRepository: fakeAccess(calls, current) }));
}

// ---- Rule 1: migration 062 -------------------------------------------------------------------------------------

test('migration 062 seeds the two personal-data permissions with exactly the student and teacher grants', () => {
  const sql = readFileSync('src/db/migrations/062_seed_patient_personal_data_permissions.sql', 'utf8');
  assert.match(sql, /INSERT INTO permissions \(permission, enforced\) VALUES/);
  assert.match(sql, /\('patient-personal-data:read', true\)/);
  assert.match(sql, /\('patient-personal-data:write', true\)/);
  assert.match(sql, /ON CONFLICT \(permission\) DO NOTHING/);
  assert.match(sql, /ON CONFLICT \(role, permission\) DO NOTHING/);
  const grants = [...sql.matchAll(/\('([a-z]+)', 'patient-personal-data:(read|write)'\)/g)].map(([, role, action]) => `${role}:${action}`).sort();
  assert.deepEqual(grants, ['estudiante:read', 'estudiante:write', 'teacher:read']);
  assert.doesNotMatch(sql, /'admin'|'reception'/);
});

// ---- Rule 2: GET /patients/:id/personal-data -------------------------------------------------------------------

test('GET personal-data returns the nine-key identity projection, no-store, for student and teacher', async () => {
  for (const role of ['estudiante', 'teacher']) {
    const calls = [];
    const server = await serve(mountWith(calls), { userId: actor, role, permissions: [READ] });
    try {
      const response = await server.call(`/patients/${patientId}/personal-data`);
      assert.equal(response.status, 200, role);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(response.body), VIEW_KEYS);
      assert.deepEqual(response.body, VIEW);
      assert.deepEqual(calls, [['read', patientId, { id: actor, role }]]);
    } finally { await server.close(); }
  }
});

test('GET personal-data never exposes email, celular or audit fields even if the repository returns them', async () => {
  const calls = [];
  const extra = record({ email: 'ana@example.com', celular: '123', createdBy: actor, createdAt: '2020-01-01T00:00:00.000Z',
    updatedBy: actor, updatedAt: '2020-01-02T00:00:00.000Z' });
  const server = await serve(mountWith(calls, extra), { userId: actor, role: 'estudiante', permissions: [READ] });
  try {
    const response = await server.call(`/patients/${patientId}/personal-data`);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body), VIEW_KEYS);
    assert.deepEqual(response.body, VIEW);
  } finally { await server.close(); }
});

test('GET personal-data denies missing permission and other roles before any lookup', async () => {
  const cases = [
    [{ userId: actor, role: 'admin', permissions: [] }, forbidden("Permission 'patient-personal-data:read' required")],
    [{ userId: actor, role: 'reception', permissions: [] }, forbidden("Permission 'patient-personal-data:read' required")],
    [{ userId: actor, role: 'admin', permissions: [READ] }, forbidden('estudiante or teacher role required')],
    [{ userId: actor, role: 'reception', permissions: [READ] }, forbidden('estudiante or teacher role required')],
    [undefined, unauthorized('Authentication required')],
  ];
  for (const [auth, expected] of cases) {
    const calls = [];
    const server = await serve(mountWith(calls), auth);
    try {
      const response = await server.call(`/patients/${patientId}/personal-data`);
      assert.equal(response.status, expected.error.code === 'UNAUTHORIZED' ? 401 : 403);
      assert.deepEqual(response.body, expected);
    } finally { await server.close(); }
    assert.deepEqual(calls, []);
  }
});

test('GET personal-data checks role, actor, id and query string in that order', async () => {
  const calls = [];
  const noActor = await serve(mountWith(calls), { role: 'estudiante', permissions: [READ] });
  try {
    const response = await noActor.call(`/patients/${patientId}/personal-data`);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, unauthorized('A verified UUID actor is required'));
  } finally { await noActor.close(); }
  const reception = await serve(mountWith(calls), { role: 'reception', permissions: [READ] });
  try {
    const response = await reception.call(`/patients/${patientId}/personal-data`);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, forbidden('estudiante or teacher role required'));
  } finally { await reception.close(); }
  const student = await serve(mountWith(calls), { userId: actor, role: 'estudiante', permissions: [READ] });
  try {
    const badId = await student.call('/patients/not-a-uuid/personal-data?x=1');
    assert.equal(badId.status, 400);
    assert.deepEqual(badId.body, bad('id must be a UUID'));
    const query = await student.call(`/patients/${patientId}/personal-data?full=1`);
    assert.equal(query.status, 400);
    assert.deepEqual(query.body, bad('query parameters are not supported'));
    const unknown = await student.call(`/patients/${unknownId}/personal-data`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, NOT_FOUND);
  } finally { await student.close(); }
  assert.deepEqual(calls, [['read', unknownId, { id: actor, role: 'estudiante' }]]);
});

test('GET personal-data with an unverifiable actor id answers 401 before the id check', async () => {
  const server = await serve(mountWith([]), { userId: 'not-a-uuid', role: 'teacher', permissions: [READ] });
  try {
    const response = await server.call('/patients/not-a-uuid/personal-data');
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, unauthorized('A verified UUID actor is required'));
  } finally { await server.close(); }
});

// ---- Rule 3: PATCH /patients/:id/personal-data -----------------------------------------------------------------

test('student PATCH updates only the sent fields and returns the nine-key projection', async () => {
  const calls = [];
  const server = await serve(mountWith(calls), { userId: actor, role: 'estudiante', permissions: [WRITE] });
  try {
    const both = await server.call(`/patients/${patientId}/personal-data`, 'PATCH', { marital_status: 'married', medical_insurance: 'none' });
    assert.equal(both.status, 200);
    assert.equal(both.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(both.body), VIEW_KEYS);
    assert.deepEqual(both.body, { ...VIEW, marital_status: 'married', medical_insurance: 'none' });
    const cleared = await server.call(`/patients/${patientId}/personal-data`, 'PATCH', { medical_insurance: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.medical_insurance, null);
    assert.equal(cleared.body.marital_status, 'single');
    assert.deepEqual(calls, [
      ['update', patientId, { maritalStatus: 'married', medicalInsurance: 'none' }, { id: actor, role: 'estudiante' }],
      ['update', patientId, { medicalInsurance: null }, { id: actor, role: 'estudiante' }],
    ]);
  } finally { await server.close(); }
});

test('student PATCH rejects non-student roles, missing permission and invalid bodies before any write', async () => {
  const calls = [];
  const teacher = await serve(mountWith(calls), { userId: actor, role: 'teacher', permissions: [WRITE] });
  try {
    const response = await teacher.call(`/patients/${patientId}/personal-data`, 'PATCH', { marital_status: 'single' });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, forbidden('student role required'));
  } finally { await teacher.close(); }
  const admin = await serve(mountWith(calls), { userId: actor, role: 'admin', permissions: [WRITE] });
  try {
    const response = await admin.call(`/patients/${patientId}/personal-data`, 'PATCH', { marital_status: 'single' });
    assert.deepEqual(response.body, forbidden('student role required'));
  } finally { await admin.close(); }
  const noPermission = await serve(mountWith(calls), { userId: actor, role: 'estudiante', permissions: [READ] });
  try {
    const response = await noPermission.call(`/patients/${patientId}/personal-data`, 'PATCH', { marital_status: 'single' });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, forbidden("Permission 'patient-personal-data:write' required"));
  } finally { await noPermission.close(); }
  const student = await serve(mountWith(calls), { userId: actor, role: 'estudiante', permissions: [WRITE] });
  try {
    const rejected = [
      [{ nombres: 'Changed' }, PATCH_FIELDS],
      [{ marital_status: 'single', email: 'x@example.com' }, PATCH_FIELDS],
      [{}, PATCH_REQUIRED],
      [[], 'body must be an object'],
      [{ marital_status: 'soltero' }, MARITAL],
      [{ medical_insurance: 'IPS' }, INSURANCE],
    ];
    for (const [body, message] of rejected) {
      const response = await student.call(`/patients/${patientId}/personal-data`, 'PATCH', body);
      assert.equal(response.status, 400, message);
      assert.deepEqual(response.body, bad(message));
    }
    const badId = await student.call('/patients/not-a-uuid/personal-data', 'PATCH', { marital_status: 'single' });
    assert.equal(badId.status, 400);
    assert.deepEqual(badId.body, bad('id must be a UUID'));
    const unknown = await student.call(`/patients/${unknownId}/personal-data`, 'PATCH', { marital_status: 'single' });
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, NOT_FOUND);
  } finally { await student.close(); }
  assert.deepEqual(calls, [['update', unknownId, { maritalStatus: 'single' }, { id: actor, role: 'estudiante' }]]);
});

test('student PATCH without a verified actor answers 401 before the body is read', async () => {
  const calls = [];
  const server = await serve(mountWith(calls), { role: 'estudiante', permissions: [WRITE] });
  try {
    const response = await server.call(`/patients/${patientId}/personal-data`, 'PATCH', { marital_status: 'single' });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, unauthorized('A verified UUID actor is required'));
  } finally { await server.close(); }
  assert.deepEqual(calls, []);
});

// ---- Rule 4 + 5: pg access repository (SQL shape, fake pool / fake unit of work) ----------------------------------

async function loadAccessRepository() {
  const { PgPatientPersonalDataAccessRepository } = await import('../../src/modules/patients/infrastructure/repositories/pg-patient-personal-data-access.repository.ts');
  return PgPatientPersonalDataAccessRepository;
}

const PROJECTION_ROW = { id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02',
  sexo: 'F', direccion: 'Calle 1', marital_status: 'married', medical_insurance: 'none' };

test('pg read decides student and teacher access in one SQL statement keyed by the selected role', async () => {
  const PgAccess = await loadAccessRepository();
  const queries = [];
  const pool = { async query(text, params) { queries.push({ text, params }); return { rows: [] }; } };
  const repository = new PgAccess({ withTransaction() { throw new Error('reads must not open a transaction'); } }, pool);
  assert.equal(await repository.readPersonalData(patientId, { id: actor, role: 'teacher' }), null);
  assert.equal(await repository.readPersonalData(patientId, { id: actor, role: 'estudiante' }), null);
  const [teacherRead, studentRead] = queries;
  assert.deepEqual(teacherRead.params, [patientId, actor, 'teacher']);
  assert.deepEqual(studentRead.params, [patientId, actor, 'estudiante']);
  const sql = teacherRead.text;
  assert.match(sql, /\$3 = 'estudiante' AND EXISTS/);
  assert.match(sql, /\$3 = 'teacher' AND EXISTS/);
  assert.match(sql, /s\.user_id = \$2/);
  assert.match(sql, /t\.user_id = \$2/);
  assert.match(sql, /sp\.revoked_at IS NULL/);
  assert.match(sql, /th\.revoked_at IS NULL/);
  assert.match(sql, /a\.patient_id = p\.id AND a\.ended_at IS NULL/);
  assert.match(sql, /a\.subject_id = sp\.subject_id/);
  assert.match(sql, /th\.subject_id = sp\.subject_id/);
  assert.match(sql, /th\.academic_group_id = sp\.academic_group_id/);
  assert.match(sql, /to_char\(fecha_nacimiento, 'YYYY-MM-DD'\) AS fecha_nacimiento/);
  const selectList = sql.slice(0, sql.indexOf(' FROM '));
  assert.doesNotMatch(selectList, /email|celular|created_|updated_/);
  assert.doesNotMatch(sql, /origin_|author_id/);
});

test('pg read maps the projection row to the application record', async () => {
  const PgAccess = await loadAccessRepository();
  const pool = { async query() { return { rows: [PROJECTION_ROW] }; } };
  const repository = new PgAccess({ withTransaction() {} }, pool);
  assert.deepEqual(await repository.readPersonalData(patientId, { id: actor, role: 'estudiante' }), {
    id: patientId, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fechaNacimiento: '1990-01-02',
    sexo: 'F', direccion: 'Calle 1', maritalStatus: 'married', medicalInsurance: 'none',
  });
});

function writeHarness({ students = [{ id: 'student-1' }], periods = [{ id: 'period-1' }], patients = [{ id: patientId }],
  assignments = [{ id: '1' }] } = {}) {
  const statements = [];
  let transactions = 0;
  const client = {
    async query(text, params) {
      statements.push({ text, params });
      if (/FROM students/.test(text)) return { rows: students };
      if (/FROM student_academic_habilitations/.test(text)) return { rows: periods };
      if (/FROM patients WHERE id = \$1 FOR UPDATE/.test(text)) return { rows: patients };
      if (/FROM patient_assignments/.test(text)) return { rows: assignments };
      if (/UPDATE patients/.test(text)) return { rows: [PROJECTION_ROW] };
      throw new Error(`unexpected statement: ${text}`);
    },
  };
  const unitOfWork = { async withTransaction(work) { transactions += 1; return work(client); } };
  const pool = { async query() { throw new Error('writes must run inside the transaction, not on the pool'); } };
  return { statements, unitOfWork, pool, transactions: () => transactions };
}

const kindOf = (text) => /FROM students/.test(text) ? 'student'
  : /FROM student_academic_habilitations/.test(text) ? 'habilitation'
  : /UPDATE patients/.test(text) ? 'update'
  : /FROM patients WHERE id = \$1 FOR UPDATE/.test(text) ? 'patient'
  : 'assignment';

test('pg student write runs one transaction that locks student period, patient and assignment before the UPDATE', async () => {
  const PgAccess = await loadAccessRepository();
  const harness = writeHarness();
  const repository = new PgAccess(harness.unitOfWork, harness.pool);
  const updated = await repository.updateAsStudent(patientId, { maritalStatus: 'married' }, { id: actor, role: 'estudiante' });
  assert.equal(harness.transactions(), 1);
  assert.deepEqual(harness.statements.map(({ text }) => kindOf(text)), ['student', 'habilitation', 'patient', 'assignment', 'update']);
  const [student, period, patient, assignment, update] = harness.statements;
  assert.match(student.text, /FOR KEY SHARE/);
  assert.deepEqual(student.params, [actor]);
  assert.match(period.text, /h\.revoked_at IS NULL/);
  assert.match(period.text, /FOR UPDATE OF h/);
  assert.match(patient.text, /FOR UPDATE/);
  assert.deepEqual(patient.params, [patientId]);
  assert.match(assignment.text, /a\.ended_at IS NULL/);
  assert.match(assignment.text, /FOR UPDATE OF a/);
  assert.deepEqual(assignment.params, [patientId, ['period-1']]);
  assert.match(update.text, /marital_status = CASE WHEN \$2::boolean/);
  assert.match(update.text, /updated_by = \$6/);
  assert.match(update.text, /updated_at = clock_timestamp\(\)/);
  assert.deepEqual(update.params, [patientId, true, 'married', false, null, actor]);
  assert.equal(updated.maritalStatus, 'married');
  assert.equal(updated.medicalInsurance, 'none');
});

test('pg student write keeps the stored value of omitted fields and writes null when cleared', async () => {
  const PgAccess = await loadAccessRepository();
  const harness = writeHarness();
  const repository = new PgAccess(harness.unitOfWork, harness.pool);
  await repository.updateAsStudent(patientId, { medicalInsurance: null }, { id: actor, role: 'estudiante' });
  const update = harness.statements.at(-1);
  assert.deepEqual(update.params, [patientId, false, null, true, null, actor]);
});

test('pg student write writes nothing when any access step finds no row', async () => {
  const PgAccess = await loadAccessRepository();
  const missing = [
    { students: [] },
    { periods: [] },
    { patients: [] },
    { assignments: [] },
  ];
  for (const overrides of missing) {
    const harness = writeHarness(overrides);
    const repository = new PgAccess(harness.unitOfWork, harness.pool);
    assert.equal(await repository.updateAsStudent(patientId, { maritalStatus: 'single' }, { id: actor, role: 'estudiante' }), null);
    assert.equal(harness.statements.some(({ text }) => /UPDATE patients/.test(text)), false, JSON.stringify(overrides));
  }
});

test('pg student write rejects non-student roles before opening a transaction', async () => {
  const PgAccess = await loadAccessRepository();
  const harness = writeHarness();
  const repository = new PgAccess(harness.unitOfWork, harness.pool);
  await assert.rejects(
    repository.updateAsStudent(patientId, { maritalStatus: 'single' }, { id: actor, role: 'teacher' }),
    { statusCode: 403, message: 'student role required' },
  );
  assert.equal(harness.transactions(), 0);
  assert.deepEqual(harness.statements, []);
});
