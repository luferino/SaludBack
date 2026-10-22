import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTeacherRouter } from '../../src/modules/teachers/infrastructure/routes/teacher.routes.ts';
import { createStudentRouter } from '../../src/modules/students/infrastructure/routes/student.routes.ts';
import { PgTeacherRepository } from '../../src/modules/teachers/infrastructure/repositories/pg-teacher.repository.ts';
import { PgStudentRepository } from '../../src/modules/students/infrastructure/repositories/pg-student.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const noop = async () => {};
const denied = { async authorize() { throw Object.assign(new Error('denied'), { status: 403 }); } };
function fakeDependencies(rows = []) {
  const calls = [];
  const repository = {
    async list(input) { calls.push(input); return rows; },
    async findByCodalumno() { return null; },
    async create(value) { return value; },
  };
  return { calls, repository, userRepository: { async findByUsername() { return null; }, async findByEmail() { return null; }, async create() {} }, hasher: { async hash() { return 'hash'; } }, unitOfWork: { async withTransaction(fn) { return fn({}); } } };
}
function serverFor(resource, deps, options = {}) {
  const app = express();
  app.use((req, _res, next) => { if (!options.unauthenticated) req.auth = { permissions: options.permissions ?? [] }; next(); });
  app.use(`/${resource}`, resource === 'teachers'
    ? createTeacherRouter({ repository: deps.repository, userRepository: deps.userRepository, hasher: deps.hasher, unitOfWork: deps.unitOfWork, ...options })
    : createStudentRouter({ repository: deps.repository, userRepository: deps.userRepository, hasher: deps.hasher, unitOfWork: deps.unitOfWork, ...options }));
  app.use(errorHandler);
  const server = app.listen(0);
  return new Promise(resolve => server.once('listening', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
async function request(resource, deps, path = '', options = {}) {
  const { server, url } = await serverFor(resource, deps, options);
  try { return await fetch(`${url}/${resource}${path}`, { method: options.method ?? 'GET', headers: { 'content-type': 'application/json' }, body: options.method === 'POST' ? JSON.stringify({ username: 'person1', password: 'secret12345', nombres: 'Test', apellidos: 'Person', codalumno: 'A123' }) : undefined }); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('GET profiles returns whitelisted projections, pagination defaults, and profile IDs', async () => {
  for (const [resource, row, expected] of [
    ['teachers', { id: 't1', nombres: 'Ana', apellidos: 'Zeta', user_id: 'secret', email: 'private' }, { id: 't1', nombres: 'Ana', apellidos: 'Zeta' }],
    ['students', { id: 's1', nombres: 'Luis', apellidos: 'Alfa', codalumno: 'C1', user_id: 'secret', email: 'private' }, { id: 's1', nombres: 'Luis', apellidos: 'Alfa', codalumno: 'C1' }],
  ]) {
    const deps = fakeDependencies([row]);
    const response = await request(resource, deps, '', { listGuard: { authorize: noop } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [expected], limit: 50, offset: 0 });
    assert.deepEqual(deps.calls, [{ limit: 50, offset: 0 }]);
  }
});

test('GET profiles parses bounded pagination and rejects malformed/out-of-range values', async () => {
  for (const resource of ['teachers', 'students']) {
    const deps = fakeDependencies([]);
    const response = await request(resource, deps, '?limit=100&offset=10000', { listGuard: { authorize: noop } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [], limit: 100, offset: 10000 });
    assert.deepEqual(deps.calls, [{ limit: 100, offset: 10000 }]);
    for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?offset=-1', '?offset=10001', '?offset=wat']) {
      const invalid = await request(resource, fakeDependencies([]), query, { listGuard: { authorize: noop } });
      assert.equal(invalid.status, 400, `${resource} ${query}`);
    }
  }
});

test('GET profiles requires independent read permission and does not inherit POST write guard', async () => {
  for (const resource of ['teachers', 'students']) {
    const deps = fakeDependencies([]);
    const missing = await request(resource, deps, '', { unauthenticated: true });
    assert.equal(missing.status, 401);
    const writeOnly = await request(resource, deps, '', { permissions: [`${resource}:write`] });
    assert.equal(writeOnly.status, 403);
    const read = await request(resource, deps, '', { permissions: [`${resource}:read`] });
    assert.equal(read.status, 200);
    const post = await request(resource, deps, '', { method: 'POST', guard: denied, listGuard: { authorize: noop } });
    assert.equal(post.status, 403);
  }
});

test('PostgreSQL listing selects only public columns in stable order with bound pagination', async () => {
  for (const [Repository, table, columns] of [
    [PgTeacherRepository, 'teachers', 'id, nombres, apellidos'],
    [PgStudentRepository, 'students', 'id, nombres, apellidos, codalumno'],
  ]) {
    const calls = [];
    const repo = new Repository({ async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } });
    assert.deepEqual(await repo.list({ limit: 17, offset: 31 }), []);
    assert.match(calls[0].sql, new RegExp(`SELECT ${columns.replaceAll(', ', ', ')} FROM ${table}`));
    assert.doesNotMatch(calls[0].sql, /user_id|email|celular|password/i);
    assert.match(calls[0].sql, /ORDER BY apellidos ASC, nombres ASC, id ASC LIMIT \$1 OFFSET \$2/);
    assert.deepEqual(calls[0].params, [17, 31]);
  }
});
