import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';
import { Guard } from '../../src/modules/shared/application/guard.ts';
import { PgUnitOfWork } from '../../src/modules/shared/infrastructure/pg-unit-of-work.ts';
import { PgPatientAvailabilityRepository, createPatientAvailabilityRouter } from '../../src/modules/patient-availabilities/index.ts';

const patient = '70000000-0000-4000-8000-000000000001';
const subject = '10000000-0000-4000-8000-000000000001';
const group = '20000000-0000-4000-8000-000000000001';
const actor = '40000000-0000-4000-8000-000000000001';
const other = '40000000-0000-4000-8000-000000000002';
const row = (overrides = {}) => ({ id: '80000000-0000-4000-8000-000000000001', patient_id: patient, subject_id: subject, academic_group_id: group, enabled_by: actor, enabled_at: new Date('2026-01-01T00:00:00Z'), withdrawn_by: null, withdrawn_at: null, ...overrides });

function fakeGuards({ manage = true, read = true, assignment = true } = {}) {
  const calls = [];
  class TestGuard extends Guard { constructor(key, allowed) { super(); this.key = key; this.allowed = allowed; } async authorize() { calls.push(this.key); if (!this.allowed) throw new ForbiddenError(`Permission '${this.key}' required`); } }
  return { calls, manageGuard: new TestGuard('patient-availabilities:manage', manage), readGuard: new TestGuard('patient-availabilities:read', read), assignmentGuard: new TestGuard('patient-assignments:write', assignment) };
}
function fakeRepository() {
  const state = { history: [], calls: [], sequence: 0, assignmentWrites: 0 };
  return { state,
    async enable(input) { state.calls.push(['enable', input]); if (state.history.some(r => r.patient_id === input.patientId && r.subject_id === input.subjectId && r.academic_group_id === input.groupId && !r.withdrawn_at)) throw new ConflictError('patient is already available in this context'); const result = row({ id: `80000000-0000-4000-8000-${String(++state.sequence).padStart(12, '0')}`, enabled_by: input.actorId, documento: 'private', celular: 'private' }); state.history.push(result); return result; },
    async withdraw(id, actorId) { state.calls.push(['withdraw', id, actorId]); const result = state.history.find(r => r.id === id); if (!result) throw new Error('missing'); if (!result.withdrawn_at) { result.withdrawn_by = actorId; result.withdrawn_at = new Date('2026-01-02T00:00:00Z'); } return result; },
    async history(id, limit, offset) { state.calls.push(['history', id]); return state.history.filter(r => r.patient_id === id).slice(offset, offset + limit); },
    async searchPatient(documento) { state.calls.push(['search', documento]); return documento === '00-X' ? [{ patient_id: patient, nombres: 'Ada', apellidos: 'Lovelace', documento, celular: 'private' }] : []; },
    async listTeacher(actorId, subjectId, groupId, limit, offset) { state.calls.push(['list', actorId, subjectId, groupId]); return actorId === actor && subjectId === subject && groupId === group && state.history.some(r => !r.withdrawn_at) ? [{ patient_id: patient, nombres: 'Ada', apellidos: 'Lovelace', documento: 'private' }] : []; },
  };
}
async function withRouter({ repository = fakeRepository(), guards = fakeGuards(), actorId = actor }, run) {
  const app = express(); app.use(express.json());
  app.use('/patient-availabilities', createPatientAvailabilityRouter({ repository, ...guards, getActor: async () => actorId }));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: { code: error.code ?? 'INTERNAL', message: error.message } }));
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, repository, guards); } finally { await new Promise(resolve => server.close(resolve)); }
}
async function request(base, method, path, body) { return fetch(base + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
const enableBody = { patient_id: patient, subject_id: subject, academic_group_id: group };
const expectedError = (code, message) => ({ error: { code, message } });

test('exports the PostgreSQL repository and router factory', () => { assert.equal(typeof PgPatientAvailabilityRepository, 'function'); assert.equal(typeof createPatientAvailabilityRouter, 'function'); });

test('write routes and teacher reads reject missing or malformed verified actor before repository calls', async () => {
  for (const actorId of [null, 'not-a-uuid']) await withRouter({ actorId }, async (base, repo) => {
    for (const [method, path, body] of [['POST', '/patient-availabilities', enableBody], ['POST', `/patient-availabilities/${row().id}/withdraw`, {}], ['GET', `/patient-availabilities?subject_id=${subject}&academic_group_id=${group}`]]) {
      const response = await request(base, method, path, body); assert.equal(response.status, 401); assert.deepEqual(await response.json(), expectedError('UNAUTHORIZED', 'A verified UUID actor is required'));
    }
    assert.deepEqual(repo.state.calls, []);
  });
});

test('real public router exposes exact approved availability fields, cache controls and pagination defaults', async () => {
  const repository = fakeRepository();
  await withRouter({ repository }, async (base) => {
    let response = await request(base, 'POST', '/patient-availabilities', enableBody);
    assert.equal(response.status, 201); const created = await response.json();
    assert.deepEqual(Object.keys(created).sort(), ['id','patient_id','subject_id','academic_group_id','enabled_by','enabled_at','withdrawn_by','withdrawn_at'].sort());
    const id = created.id;
    response = await request(base, 'GET', `/patient-availabilities/manage?patient_id=${patient}`); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const history = await response.json(); assert.deepEqual(Object.keys(history.items[0]).sort(), Object.keys(created).sort()); assert.equal(history.limit, 50); assert.equal(history.offset, 0);
    response = await request(base, 'POST', '/patient-availabilities/patient-search', { documento: ' 00-X  ' }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json(); assert.deepEqual(result, { items: [{ patient_id: patient, nombres: 'Ada', apellidos: 'Lovelace' }] });
    assert.deepEqual(repository.state.calls.find(c => c[0] === 'search'), ['search', '00-X']);
    response = await request(base, 'GET', `/patient-availabilities?subject_id=${subject}&academic_group_id=${group}`); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const listing = await response.json(); assert.deepEqual(listing.items, [{ patient_id: patient, nombres: 'Ada', apellidos: 'Lovelace' }]); assert.equal(listing.limit, 50); assert.equal(listing.offset, 0);
    response = await request(base, 'POST', `/patient-availabilities/${id}/withdraw`, {}); assert.equal(response.status, 200);
  });
});

test('admin exact-document search trims only outer whitespace before repository lookup', async () => {
  await withRouter({}, async base => {
    const response = await request(base, 'POST', '/patient-availabilities/patient-search', { documento: ' 00-X ' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ patient_id: patient, nombres: 'Ada', apellidos: 'Lovelace' }] });
  });
});

test('exact-document admin search returns empty or one whitelisted hit; unauthorized requests never search', async () => {
  await withRouter({ guards: fakeGuards({ manage: false }) }, async (base, repo) => {
    const response = await request(base, 'POST', '/patient-availabilities/patient-search', { documento: '00-X' }); assert.equal(response.status, 403); assert.deepEqual(await response.json(), expectedError('FORBIDDEN', "Permission 'patient-availabilities:manage' required")); assert.deepEqual(repo.state.calls, []);
  });
  await withRouter({}, async (base, repo) => {
    let response = await request(base, 'POST', '/patient-availabilities/patient-search', { documento: 'missing' }); assert.deepEqual(await response.json(), { items: [] });
    response = await request(base, 'POST', '/patient-availabilities/patient-search', { documento: '00-X' }); const body = await response.json(); assert.deepEqual(Object.keys(body.items[0]).sort(), ['patient_id','nombres','apellidos'].sort()); assert.deepEqual(repo.state.calls.filter(c => c[0] === 'search').map(c => c[1]), ['missing','00-X']);
  });
});

test('permissions, UUID validation and pagination arrays/bounds reject before repository access', async () => {
  await withRouter({ guards: fakeGuards({ read: true, assignment: false }) }, async (base, repo) => { const response = await request(base, 'GET', `/patient-availabilities?subject_id=${subject}&academic_group_id=${group}`); assert.equal(response.status, 403); assert.deepEqual(repo.state.calls, []); });
  await withRouter({}, async (base, repo) => {
    for (const [path, message] of [
      ['/patient-availabilities/manage?patient_id=bad', 'patient_id must be a UUID'],
      ['/patient-availabilities/manage?patient_id='+patient+'&limit=101', 'limit must be between 1 and 100'],
      ['/patient-availabilities/manage?patient_id='+patient+'&offset=10001', 'offset must be between 0 and 10000'],
      ['/patient-availabilities/manage?patient_id='+patient+'&limit=1&limit=2', 'limit must be an integer'],
      ['/patient-availabilities?subject_id='+subject+'&academic_group_id=bad', 'academic_group_id must be a UUID'],
    ]) { const response = await request(base, 'GET', path); assert.equal(response.status, 400); assert.deepEqual(await response.json(), expectedError('BAD_REQUEST', message)); }
    for (const body of [{ ...enableBody, patient_id: 'bad' }, { documento: '  ' }]) { const path = body.documento === '  ' ? '/patient-availabilities/patient-search' : '/patient-availabilities'; const response = await request(base, 'POST', path, body); assert.equal(response.status, 400); }
    assert.deepEqual(repo.state.calls, []);
  });
});

test('router-facing lifecycle rejects duplicates, preserves withdrawal audit on repeat, and creates a fresh re-enabled period', async () => {
  const repository = fakeRepository();
  await withRouter({ repository }, async base => {
    const created = await (await request(base, 'POST', '/patient-availabilities', enableBody)).json();
    let response = await request(base, 'POST', '/patient-availabilities', enableBody); assert.equal(response.status, 409); assert.deepEqual(await response.json(), expectedError('CONFLICT', 'patient is already available in this context'));
    const originalHistory = JSON.stringify(repository.state.history);
    response = await request(base, 'POST', `/patient-availabilities/${created.id}/withdraw`, {}); assert.equal(response.status, 200); const withdrawn = await response.json();
    response = await request(base, 'POST', `/patient-availabilities/${created.id}/withdraw`, {}); assert.deepEqual(await response.json(), withdrawn);
    assert.notEqual(JSON.stringify(repository.state.history), originalHistory);
    response = await request(base, 'POST', '/patient-availabilities', enableBody); assert.equal(response.status, 201); assert.notEqual((await response.json()).id, created.id); assert.equal(repository.state.history.length, 2);
  });
});

test('PgPatientAvailabilityRepository serializes on patient before availability mutation and rolls back/release on rejection', async () => {
  const calls = []; let releases = 0, commits = 0, rollbacks = 0;
  const client = { async query(sql, params = []) { calls.push({ sql, params }); if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') { if (sql === 'COMMIT') commits++; if (sql === 'ROLLBACK') rollbacks++; return { rows: [] }; }
    if (sql.includes('FROM patients')) return { rows: [{ id: patient }] };
    if (sql.includes('FROM subject_academic_groups')) return { rows: [{ id: subject }] };
    if (sql.includes('INSERT INTO patient_context_availabilities')) { const e = new Error('duplicate'); e.code = '23505'; e.constraint = 'patient_context_availabilities_one_active'; throw e; }
    throw new Error(`unexpected SQL: ${sql}`); }, release() { releases++; } };
  const pool = { connect: async () => client, query: async () => ({ rows: [] }) };
  const repository = new PgPatientAvailabilityRepository(new PgUnitOfWork(pool), pool);
  await assert.rejects(repository.enable({ patientId: patient, subjectId: subject, groupId: group, actorId: actor }), error => error.statusCode === 409);
  const patientLock = calls.findIndex(c => c.sql.includes('FROM patients') && c.sql.includes('FOR UPDATE'));
  const periodMutation = calls.findIndex(c => c.sql.includes('INSERT INTO patient_context_availabilities'));
  assert.ok(patientLock >= 0 && periodMutation > patientLock); assert.equal(commits, 0); assert.equal(rollbacks, 1); assert.equal(releases, 1);
  assert.equal(calls.some(c => /UPDATE|DELETE/i.test(c.sql) && /patient_assignments/.test(c.sql)), false);
});

test('teacher availability query requires exact live actor context and excludes withdrawn periods without student scope', async () => {
  let sqlSeen = '';
  const pool = { async query(sql) { sqlSeen = sql; return { rows: [] }; } };
  const repo = new PgPatientAvailabilityRepository({ withTransaction: async fn => fn({ query: async () => ({ rows: [] }) }) }, pool);
  assert.deepEqual(await repo.listTeacher(other, subject, group, 50, 0), []);
  assert.match(sqlSeen, /withdrawn_at IS NULL/); assert.match(sqlSeen, /teachers t/); assert.match(sqlSeen, /t\.user_id = \$1/);
  assert.match(sqlSeen, /h\.subject_id = \$2 AND h\.academic_group_id = \$3 AND h\.revoked_at IS NULL/);
  assert.match(sqlSeen, /ORDER BY p\.apellidos, p\.nombres, p\.id/); assert.doesNotMatch(sqlSeen, /student_academic_habilitations|clinical_records|documento|celular/);
});

test('real PgUnitOfWork plus fake Pool preserves enable/withdraw history, idempotent audit, and re-enable periods', async () => {
  const state = { periods: [], serial: 0, tx: null, commits: 0, rollbacks: 0, releases: 0, assignments: 0, queries: [] };
  const stamp = '2026-02-03T04:05:06.000Z';
  async function query(sql, params = []) {
    state.queries.push(sql);
    if (sql === 'BEGIN') { state.tx = structuredClone(state.periods); return { rows: [] }; }
    if (sql === 'COMMIT') { state.periods = state.tx; state.tx = null; state.commits++; return { rows: [] }; }
    if (sql === 'ROLLBACK') { state.tx = null; state.rollbacks++; return { rows: [] }; }
    const periods = state.tx ?? state.periods;
    if (/FROM patients/.test(sql)) return { rows: [{ id: patient }] };
    if (/FROM subject_academic_groups/.test(sql)) return { rows: [{ id: subject }] };
    if (/INSERT INTO patient_context_availabilities/.test(sql)) {
      const [patientId, subjectId, groupId, enabledBy] = params;
      if (periods.some(p => p.patient_id === patientId && p.subject_id === subjectId && p.academic_group_id === groupId && !p.withdrawn_at)) {
        const e = new Error('duplicate'); e.code = '23505'; e.constraint = 'patient_context_availabilities_one_active'; throw e;
      }
      const inserted = row({ id: `80000000-0000-4000-8000-${String(++state.serial).padStart(12, '0')}`, enabled_by: enabledBy, enabled_at: stamp }); periods.push(inserted); return { rows: [inserted] };
    }
    if (/FROM patient_context_availabilities/.test(sql) && /SELECT patient_id/.test(sql)) { const p = periods.find(x => x.id === params[0]); return { rows: p ? [{ patient_id: p.patient_id }] : [] }; }
    if (/UPDATE patient_context_availabilities/.test(sql)) { const p = periods.find(x => x.id === params[0]); if (p && !p.withdrawn_at) { p.withdrawn_by = params[1]; p.withdrawn_at = stamp; } return { rows: p ? [p] : [] }; }
    if (/patient_assignments/.test(sql)) { state.assignments++; throw new Error('availability may not mutate assignments'); }
    throw new Error(`unexpected SQL: ${sql}`);
  }
  const client = { query, release() { state.releases++; } };
  const pool = { connect: async () => client, async query(sql, params = []) {
    state.queries.push(sql);
    if (/FROM patient_context_availabilities/.test(sql)) return { rows: state.periods.filter(p => p.patient_id === params[0]).slice(params[2], params[2] + params[1]) };
    throw new Error(`unexpected pool SQL: ${sql}`);
  } };
  const repo = new PgPatientAvailabilityRepository(new PgUnitOfWork(pool), pool);
  const first = await repo.enable({ patientId: patient, subjectId: subject, groupId: group, actorId: actor });
  await assert.rejects(repo.enable({ patientId: patient, subjectId: subject, groupId: group, actorId: other }), e => e.statusCode === 409);
  assert.equal(state.periods.length, 1); assert.equal(state.rollbacks, 1);
  const closed = await repo.withdraw(first.id, actor), audit = [closed.withdrawn_by, closed.withdrawn_at];
  const repeated = await repo.withdraw(first.id, other); assert.deepEqual([repeated.withdrawn_by, repeated.withdrawn_at], audit);
  const second = await repo.enable({ patientId: patient, subjectId: subject, groupId: group, actorId: other });
  assert.notEqual(second.id, first.id); assert.equal(state.periods.length, 2); assert.ok(state.periods[0].withdrawn_at); assert.equal(state.periods[1].withdrawn_at, null);
  assert.equal(state.periods.filter(p => !p.withdrawn_at).length, 1); assert.equal(state.assignments, 0);
  const mutations = state.queries.filter(sql => /INSERT INTO patient_context_availabilities|UPDATE patient_context_availabilities/.test(sql));
  const patientLocks = state.queries.filter(sql => /FROM patients.*FOR UPDATE/.test(sql)); assert.equal(patientLocks.length, 5); assert.equal(mutations.length, 5);
  assert.equal(state.commits, 4); assert.equal(state.rollbacks, 1); assert.equal(state.releases, 5);
});

test('availability persistence schema enforces restrictive audit/context relationships and permission grants only', async () => {
  const { readFile } = await import('node:fs/promises');
  const schema = await readFile(new URL('../../src/db/migrations/029_create_patient_context_availabilities.sql', import.meta.url), 'utf8');
  const permissions = await readFile(new URL('../../src/db/migrations/030_seed_patient_availability_permissions.sql', import.meta.url), 'utf8');
  for (const column of ['patient_id','subject_id','academic_group_id','enabled_by','enabled_at','withdrawn_by','withdrawn_at']) assert.match(schema, new RegExp(`\\b${column}\\b`));
  assert.match(schema, /ON DELETE NO ACTION/g); assert.match(schema, /withdrawn_at >= enabled_at/); assert.match(schema, /UNIQUE INDEX[\s\S]*WHERE withdrawn_at IS NULL/i); assert.doesNotMatch(schema, /INSERT[\s\S]*patient_context_availabilities/i);
  assert.match(permissions, /\('admin', 'patient-availabilities:manage'\)/); assert.match(permissions, /\('teacher', 'patient-availabilities:read'\)/); assert.doesNotMatch(permissions, /\('(admin|teacher)', 'patient-availabilities:(read|manage)'\)[\s\S]*\1/);
});
