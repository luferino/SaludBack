import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect', JWT_SECRET: 'synthetic-composition-secret',
  CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'composition-key', JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3',
});
const { createDependencies } = await import('../../src/bootstrap/create-dependencies.ts');
const { createApp } = await import('../../src/app.ts');

test('composition shares dependencies within one app and isolates separate app factories', () => {
  const pool = { query() { throw new Error('composition must not query the database'); } };
  const first = createDependencies(pool);
  const second = createDependencies(pool);
  assert.equal(first.auth.repository, first.profiles.userRepository);
  assert.equal(first.auth.hasher, first.profiles.hasher);
  for (const area of ['profiles', 'academic', 'clinical']) {
    assert.equal(first.auth.tokenService, first[area].tokenService);
    assert.equal(first.auth.matrixReader, first[area].matrixReader);
    assert.notEqual(first[area].tokenService, second[area].tokenService);
  }
  const source = readFileSync('src/bootstrap/create-dependencies.ts', 'utf8');
  assert.equal((source.match(/new PgUnitOfWork\(pool\)/g) ?? []).length, 1);
  for (const repository of ['PgStudentHabilitationRepository', 'PgPatientAssignmentRepository', 'PgKinesiologyEvaluationRepository']) {
    assert.match(source, new RegExp(`new ${repository}\\(unitOfWork, pool\\)`));
  }
});

test('app entry point delegates composition rather than constructing concrete adapters', () => {
  const source = readFileSync('src/app.ts', 'utf8');
  assert.doesNotMatch(source, /new Pg|new Jwt|new Bcrypt|new PermissionGuard|create\w+Router/);
  assert.match(source, /createDependencies\(pool\)/);
});

test('all protected mounts reject missing tokens without SQL and global HTTP behavior remains intact', async () => {
  const queries = [];
  const pool = { async query(...args) { queries.push(args); throw new Error('unexpected SQL'); } };
  const server = createServer(createApp(pool));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = await fetch(base);
    assert.equal(root.status, 200);
    assert.equal(await root.text(), 'Hello, World!');
    for (const [method, path] of [
      ['POST', '/auth/register'], ['GET', '/auth/me'], ['POST', '/patients'],
      ['GET', '/students'], ['GET', '/teachers'], ['GET', '/subjects'], ['GET', '/groups'],
      ['GET', '/subject-groups'], ['GET', '/student-habilitations'],
      ['GET', '/patient-assignments'], ['GET', '/kinesiology-evaluations'], ['GET', '/teacher-habilitations'],
    ]) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
    }
    assert.equal((await fetch(base + '/unknown')).status, 404);
    const malformed = await fetch(base + '/patients', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'BAD_REQUEST');
    assert.deepEqual(queries, []);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
