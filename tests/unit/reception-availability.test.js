import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { createReceptionAvailabilityRouter } from '../../src/modules/reception/infrastructure/routes/reception-availability.routes.ts';

const actor = '40000000-0000-4000-8000-000000000001';
const patient = '50000000-0000-4000-8000-000000000001';
const subject = '60000000-0000-4000-8000-000000000001';
const group = '70000000-0000-4000-8000-000000000001';
const availability = '80000000-0000-4000-8000-000000000001';

async function serve(repository, { role = 'reception', permissions = ['reception:availability:manage'], authenticate } = {}) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.auth = { userId: actor, role, permissions }; next(); });
  app.use('/reception/availability', createReceptionAvailabilityRouter({ repository, getActor: async () => actor, authenticate }));
  app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/reception/availability`;
  return { base, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
const ctx = { career: 'kinesiology', subject_id: subject, academic_group_id: group, subject_name: 'Anatomía', academic_group_name: '2025 · 1 · A' };
const row = { id: availability, subject_id: subject, academic_group_id: group, enabled_at: '2025-01-01T00:00:00.000Z', withdrawn_at: null };
const safeActivity = { id: availability, subject_id: subject, academic_group_id: group, enabled_at: row.enabled_at, withdrawn_at: null };

 test('authorized Reception can list safe scoped context choices and enable availability with the explicit career', async () => {
  const calls = [];
  const repository = {
    async withActiveCareerScope(userId, career, work) { calls.push(['scope', userId, career]); return work({}); },
    async contextChoices(_db, career) { calls.push(['contexts', career]); return [ctx]; },
    async enable(_db, career, input) { calls.push(['enable', career, input]); return row; },
  };
  const http = await serve(repository);
  try {
    const contexts = await fetch(`${http.base}/contexts?career=kinesiology`);
    assert.equal(contexts.status, 200); assert.equal(contexts.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await contexts.json(), { items: [ctx], limit: 50, offset: 0 });
    const enabled = await fetch(http.base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology', patient_id: patient, subject_id: subject, academic_group_id: group }) });
    assert.equal(enabled.status, 201); assert.deepEqual(await enabled.json(), safeActivity);
    assert.deepEqual(calls.map(x => x[0]), ['scope', 'contexts', 'scope', 'enable']);
    assert.deepEqual(calls[3].slice(1), ['kinesiology', { patientId: patient, subjectId: subject, groupId: group, actorId: actor }]);
  } finally { await http.close(); }
});

test('scoped history and search return minimal activity; withdraw is scoped and idempotence stays domain-owned', async () => {
  const calls = [];
  const repository = {
    async withActiveCareerScope(userId, career, work) { calls.push(['scope', career]); return work({}); },
    async history(_db, career, id, limit, offset) { calls.push(['history', career, id, limit, offset]); return [row]; },
    async search(_db, career, documento, limit, offset) { calls.push(['search', career, documento, limit, offset]); return [{ patient_id: patient, nombres: 'Ana', apellidos: 'Perez' }]; },
    async withdraw(_db, career, id, actorId) { calls.push(['withdraw', career, id, actorId]); return { ...row, withdrawn_at: '2025-01-02T00:00:00.000Z' }; },
  };
  const http = await serve(repository);
  try {
    const history = await fetch(`${http.base}/history?career=kinesiology&patient_id=${patient}`);
    assert.equal(history.status, 200); assert.equal(history.headers.get('cache-control'), 'no-store'); assert.deepEqual((await history.json()).items, [safeActivity]);
    const search = await fetch(`${http.base}/search?career=kinesiology&documento=35123456`);
    assert.equal(search.status, 200); const searchPage = await search.json(); assert.deepEqual(searchPage.items, [{ patient_id: patient, nombres: 'Ana', apellidos: 'Perez' }]); assert.equal(searchPage.limit, 50);
    const withdrawn = await fetch(`${http.base}/${availability}/withdraw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology' }) });
    assert.equal(withdrawn.status, 200); assert.equal((await withdrawn.json()).withdrawn_at, '2025-01-02T00:00:00.000Z');
    assert.deepEqual(calls.filter(x => x[0] !== 'scope').map(x => x[0]), ['history', 'search', 'withdraw']);
  } finally { await http.close(); }
});

test('wrong role, missing narrow permission, inactive scope and malformed identifiers reject before scoped work', async () => {
  let scopes = 0;
  const repository = { async withActiveCareerScope(_user, _career, work) { scopes++; return work({}); } };
  const permissionDenied = await serve(repository, { permissions: ['reception:patients:manage'] });
  const wrongRole = await serve(repository, { role: 'teacher' });
  try {
    assert.equal((await fetch(`${permissionDenied.base}/contexts?career=kinesiology`)).status, 403);
    assert.equal((await fetch(`${wrongRole.base}/contexts?career=kinesiology`)).status, 403);
    assert.equal((await fetch(`${permissionDenied.base}/contexts?career=odontology`)).status, 403);
    assert.equal(scopes, 0);
  } finally { await permissionDenied.close(); await wrongRole.close(); }

  const inactive = await serve({ ...repository, async withActiveCareerScope() { throw Object.assign(new Error('active career scope was not found'), { statusCode: 404, expose: true }); } });
  try {
    assert.equal((await fetch(`${inactive.base}/contexts?career=kinesiology`)).status, 404);
    assert.equal(scopes, 0);
  } finally { await inactive.close(); }
});

test('invalid query/body/context input is rejected before persistence', async () => {
  let writes = 0;
  const repository = { async withActiveCareerScope(_user, _career, work) { return work({}); }, async enable() { writes++; return row; } };
  const http = await serve(repository);
  try {
    for (const path of ['/contexts?career=KINESIOLOGY', '/history?career=kinesiology&patient_id=bad', '/search?career=kinesiology&documento=x&limit=999']) assert.equal((await fetch(`${http.base}${path}`)).status, 400);
    const response = await fetch(http.base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology', patient_id: patient, subject_id: 'bad', academic_group_id: group }) });
    assert.equal(response.status, 400); assert.equal(writes, 0);
  } finally { await http.close(); }
});
