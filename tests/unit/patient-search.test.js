import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPatientRouter } from '../../src/modules/patients/infrastructure/routes/patient.routes.ts';
import { createReceptionPatientRouter } from '../../src/modules/reception/infrastructure/routes/reception-patient.routes.ts';
import { PgPatientRepository } from '../../src/modules/patients/infrastructure/repositories/pg-patient.repository.ts';
import { PgReceptionPatientRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-patient.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { mountProfileRoutes } from '../../src/bootstrap/routes/profiles.routes.ts';
import { Patient } from '../../src/modules/patients/domain/patient.entity.ts';

const actor = '40000000-0000-4000-8000-000000000001';
const grant = '40000000-0000-4000-8000-000000000002';
const row = { id: actor, documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02', email: 'ana@example.invalid', celular: '123', sexo: 'F', direccion: 'Calle 1', created_by: actor, created_at: '2020-01-01', updated_by: actor, updated_at: '2020-01-02' };
const publicRow = Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('created_') && !key.startsWith('updated_')));
const entity = { ...row, fechaNacimiento: row.fecha_nacimiento };

async function fixture(surface, run, auth, deniedScope = false) {
  const calls = [];
  const db = {};
  const repository = {
    async list(...args) { calls.push(['list', ...args]); return (surface === 'admin' ? args[0].q : args[4]) === 'absent' ? [] : [entity]; },
    async withActiveCareerScope(...args) {
      calls.push(['scope', args[0], args[1], args[3]]);
      if (deniedScope) throw Object.assign(new Error('active career scope was not found'), { statusCode: 404, expose: true });
      return args[2](db);
    },
    async findByDocumento() { return null; },
    async create(value) { calls.push(['create']); return value; },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = auth === undefined ? { userId: actor, role: surface === 'admin' ? 'admin' : 'reception', roleGrantId: grant, permissions: ['reception:patients:manage'] } : auth; next(); });
  app.use('/patients', surface === 'admin'
    ? createPatientRouter({ repository, listRepository: repository })
    : createReceptionPatientRouter({ repository }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(async (query = '', options) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/patients${query}`, options);
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: response.status, cache: response.headers.get('cache-control'), body };
    }, calls, db);
  } finally { await new Promise(resolve => server.close(resolve)); }
}

for (const surface of ['admin', 'reception']) {
  const prefix = surface === 'admin' ? '?' : '?career=kinesiology&';
  const fallback = surface === 'admin' ? 50 : 100;
  test(`${surface} patient list defaults, trims literal search, paginates and omits audits`, async () => {
    await fixture(surface, async (get, calls, db) => {
      assert.deepEqual(await get(surface === 'admin' ? '' : '?career=kinesiology'), { status: 200, cache: 'no-store', body: { items: [publicRow], limit: fallback, offset: 0 } });
      assert.deepEqual(calls.pop(), surface === 'admin' ? ['list', { q: undefined, limit: 50, offset: 0 }] : ['list', db, 'kinesiology', 100, 0, undefined]);
      if (surface === 'reception') assert.deepEqual(calls.pop(), ['scope', actor, 'kinesiology', grant]);
      assert.deepEqual((await get(`${prefix}q=%20a%25_%5C%20&limit=1&offset=10000`)).body, { items: [publicRow], limit: 1, offset: 10000 });
      assert.deepEqual(calls.pop(), surface === 'admin' ? ['list', { q: 'a%_\\', limit: 1, offset: 10000 }] : ['list', db, 'kinesiology', 1, 10000, 'a%_\\']);
      assert.deepEqual((await get(`${prefix}q=absent`)).body, { items: [], limit: fallback, offset: 0 });
      assert.equal((await get(`${prefix}q=%20%20&limit=100&offset=0`)).status, 200);
      assert.equal((await get(`${prefix}q=${'a'.repeat(100)}`)).status, 200);
      assert.equal((await get(`${prefix}q=Ana?x`)).status, 200);
    });
  });
  test(`${surface} patient list rejects malformed queries before all repository access`, async () => {
    await fixture(surface, async (get, calls) => {
      for (const [query, message] of [
        ['limit=0', 'limit must be an integer between 1 and 100'],
        ['limit=101', 'limit must be an integer between 1 and 100'],
        ['limit=1.5', 'limit must be an integer between 1 and 100'],
        ['limit=1e2', 'limit must be an integer between 1 and 100'],
        ['limit=', 'limit must be an integer between 1 and 100'],
        ['offset=-1', 'offset must be an integer between 0 and 10000'],
        ['offset=10001', 'offset must be an integer between 0 and 10000'],
        ['offset=x', 'offset must be an integer between 0 and 10000'],
        ['q=a&q=b', 'query parameter must not be repeated: q'],
        ['limit=1&limit=2', 'query parameter must not be repeated: limit'],
        ['offset=0&offset=1', 'query parameter must not be repeated: offset'],
        ['q[x]=a', 'unknown query parameter: q[x]'],
        ['unknown=x', 'unknown query parameter: unknown'],
        ['q=Ana?x&unknown=x', 'unknown query parameter: unknown'],
        [`q=${'a'.repeat(101)}`, 'q must be at most 100 characters'],
      ]) {
        const response = await get(prefix + query);
        assert.equal(response.status, 400, query);
        assert.deepEqual(response.body, { error: { code: 'BAD_REQUEST', message } }, query);
      }
      assert.deepEqual(calls, []);
    });
  });
  test(`${surface} patient list enforces active role and authentication before reading`, async () => {
    const wrongRoles = surface === 'admin' ? ['teacher', 'estudiante', 'reception'] : ['admin', 'teacher', 'estudiante'];
    const cases = [[null, 401, 'Authentication required'], ...wrongRoles.map(role => [{ userId: actor, role, permissions: ['patients:write', 'patients:read', 'reception:patients:manage'] }, 403, surface === 'admin' ? 'Admin role required' : 'Reception role required']), ...(surface === 'reception' ? [[{ userId: actor, role: 'reception', permissions: [] }, 403, "Permission 'reception:patients:manage' required"]] : [])];
    for (const [auth, status, message] of cases) {
      await fixture(surface, async (get, calls) => {
        const response = await get(prefix + 'q=secret');
        assert.equal(response.status, status);
        assert.deepEqual(response.body, { error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message } });
        assert.deepEqual(calls, []);
      }, auth);
    }
  });
}

test('Reception rejects missing/duplicate/invalid career and denies revoked scope without listing', async () => {
  await fixture('reception', async (get, calls) => {
    for (const query of ['', '?career=other', '?career=', '?career=kinesiology&career=odontology']) assert.equal((await get(query)).status, 400);
    assert.deepEqual(calls, []);
  });
  await fixture('reception', async (get, calls) => {
    assert.equal((await get('?career=odontology&q=Ana')).status, 404);
    assert.deepEqual(calls, [['scope', actor, 'odontology', grant]]);
  }, undefined, true);
});

test('PostgreSQL patient searches bind literal input and preserve scoped AND grouping and stable order', async () => {
  const q = "a%_\\'";
  const generalCalls = [], scopedCalls = [];
  const pool = { async query(sql, values) { generalCalls.push({ sql, values }); return { rows: [row] }; } };
  const db = { async query(sql, values) { scopedCalls.push({ sql, values }); return { rows: [row] }; } };
  const general = new PgPatientRepository(pool);
  const reception = new PgReceptionPatientRepository({});
  assert.equal((await general.list({ q, limit: 2, offset: 1 }))[0].fechaNacimiento, '1990-01-02');
  assert.equal((await reception.list(db, 'odontology', 2, 1, q))[0].documento, row.documento);
  assert.deepEqual(generalCalls[0].values, [q, 2, 1]);
  assert.deepEqual(scopedCalls[0].values, ['odontology', 2, 1, q]);
  for (const { sql } of [generalCalls[0], scopedCalls[0]]) {
    assert.match(sql, /ORDER BY (?:p\.)?apellidos,\s*(?:p\.)?nombres,\s*(?:p\.)?id/);
    for (const field of ['documento', 'nombres', 'apellidos']) assert.match(sql, new RegExp(`strpos\\(lower\\((?:p\\.)?${field}\\)`));
    assert.equal(sql.includes(q), false);
    assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|ILIKE/);
  }
  assert.match(scopedCalls[0].sql, /JOIN reception_patient_enrollments/);
  assert.match(scopedCalls[0].sql, /WHERE c\.code=\$1 AND \(/);
  await general.list({ limit: 50, offset: 0 });
  await reception.list(db, 'kinesiology', 100, 0);
  assert.deepEqual(generalCalls[1].values, [null, 50, 0]);
  assert.deepEqual(scopedCalls[1].values, ['kinesiology', 100, 0, null]);
});

test('profile mount separates admin list authorization from patient write permission and preserves POST attribution', async () => {
  const roles = { admin: [], teacher: [], estudiante: [] };
  const created = [];
  const repository = {
    async list() { return [new Patient({ id: row.id, documento: row.documento, nombres: row.nombres, apellidos: row.apellidos, fechaNacimiento: row.fecha_nacimiento, email: row.email, celular: row.celular, sexo: row.sexo, direccion: row.direccion })]; },
    async findByDocumento() { return null; },
    async create(patient) { created.push(patient); return new Patient({ ...patient, id: row.id, createdAt: new Date('2020-01-01T00:00:00.000Z') }); },
  };
  const app = express();
  app.use(express.json());
  mountProfileRoutes(app, {
    patientRepository: repository,
    studentRepository: {}, teacherRepository: {}, userRepository: {}, hasher: {}, unitOfWork: {},
    tokenService: { async verify(token) { if (token === 'invalid') throw new Error('invalid token'); return { role: token, sub: actor, permissions: ['patients:write'] }; } },
    matrixReader: { async permissionsForRole(role) { return roles[role] ?? []; } },
    roleGrantRepository: {},
  });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/patients`;
  const headers = role => ({ authorization: `Bearer ${role}` });
  const body = { documento: '35123456', nombres: 'Ana', apellidos: 'Perez', fecha_nacimiento: '1990-01-02', email: 'ana@example.invalid', celular: '123', sexo: 'F', direccion: 'Calle 1' };
  try {
    const missing = await fetch(base);
    assert.equal(missing.status, 401);
    const invalid = await fetch(base, { headers: headers('invalid') });
    assert.equal(invalid.status, 401);
    const adminList = await fetch(base, { headers: headers('admin') });
    assert.equal(adminList.status, 200);
    assert.deepEqual(await adminList.json(), { items: [publicRow], limit: 50, offset: 0 });
    for (const role of ['teacher', 'estudiante']) {
      const denied = await fetch(base, { headers: headers(role) });
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { error: { code: 'FORBIDDEN', message: 'Admin role required' } });
    }
    const noWrite = await fetch(base, { method: 'POST', headers: { ...headers('admin'), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(noWrite.status, 403);
    assert.equal(created.length, 0);
    roles.teacher = ['patients:write'];
    const write = await fetch(base, { method: 'POST', headers: { ...headers('teacher'), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(write.status, 201);
    const result = await write.json();
    assert.deepEqual(Object.keys(result).sort(), ['id','documento','nombres','apellidos','fecha_nacimiento','email','celular','sexo','direccion','created_by','created_at'].sort());
    assert.equal(result.created_by, actor);
    assert.equal(result.created_at, '2020-01-01T00:00:00.000Z');
    assert.equal(created[0].createdBy, actor);
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
