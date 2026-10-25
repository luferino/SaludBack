import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect', JWT_SECRET: 'synthetic-availability-composition-secret',
  CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'availability-composition-key', JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3',
});
const { createDependencies } = await import('../../src/bootstrap/create-dependencies.ts');
const { createApp } = await import('../../src/app.ts');
const { cleanDb } = await import('../integration/helpers/clean-db.js');

test('new clinical adapters are app-local and construction performs no database access', () => {
  const pool = { query() { assert.fail('construction must not query'); }, connect() { assert.fail('construction must not connect'); } };
  const first = createDependencies(pool), second = createDependencies(pool);
  for (const key of ['availabilityRepository', 'assignmentOptionsRepository']) {
    assert.ok(first.clinical[key], key);
    assert.notEqual(first.clinical[key], second.clinical[key], key);
  }
});

test('all new production mounts reject absent authentication before any database access', async () => {
  const queries = [];
  const pool = { async query(...args) { queries.push(args); assert.fail('unauthenticated request queried SQL'); } };
  const server = createServer(createApp(pool));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [method, path] of [
      ['POST', '/patient-availabilities'], ['POST', '/patient-availabilities/patient-search'],
      ['POST', '/patient-availabilities/00000000-0000-0000-0000-000000000001/withdraw'],
      ['GET', '/patient-availabilities'], ['GET', '/patient-availabilities/manage'],
      ['GET', '/patient-assignment-options/contexts'], ['GET', '/patient-assignment-options/students'],
    ]) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
    }
    assert.deepEqual(queries, []);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('integration cleanup includes availability history before its FK parents and reseeds current read/manage grants', async () => {
  // Exercise cleanup with a recording fake only: never connect to or clean a database.
  const statements = [];
  await cleanDb({ async query(sql) {
    statements.push(sql);
    return { rows: sql.includes('has_column_privilege') ? [{ allowed: true }] : [] };
  } });
  const position = sql => statements.indexOf(sql);
  const availability = position('DELETE FROM patient_context_availabilities');
  assert.ok(availability >= 0, 'retained availability facts must be cleaned in disposable integration fixtures');
  for (const parent of ['patients', 'subject_academic_groups', 'users']) {
    assert.ok(availability < position(`DELETE FROM ${parent}`), parent);
  }
  for (const permission of ['students:read', 'student-habilitations:read', 'patient-availabilities:manage', 'patient-availabilities:read']) {
    assert.ok(statements.some(sql => sql.includes(`'${permission}'`)), `missing canonical seed: ${permission}`);
  }
});
