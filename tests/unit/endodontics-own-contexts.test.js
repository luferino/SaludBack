import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createEndodonticsSubjectRouter, PgEndodonticsSubjectRepository } from '../../src/modules/endodontics-subjects/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const actorId = '10000000-0000-4000-8000-000000000001';
async function serve(repository, run) {
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: actorId, role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/endodontics-subjects', createEndodonticsSubjectRouter({ repository })); app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/endodontics-subjects`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const headers = (role, permissions = 'endodontics-drafts:read') => ({ 'x-role': role, 'x-permissions': permissions });

test('/mine returns only subject/group contexts to students and teachers with draft-read grant', async () => {
  const contexts = [{ subject_id: 'subject-a', academic_group_id: 'group-a' }, { subject_id: 'subject-b', academic_group_id: 'group-b' }];
  const calls = [];
  await serve({ async listMine(...args) { calls.push(args); return contexts; } }, async base => {
    for (const role of ['estudiante', 'teacher']) {
      const response = await fetch(`${base}/mine`, { headers: headers(role) });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { items: contexts });
    }
    assert.equal((await fetch(`${base}/mine`, { headers: headers('estudiante', '') })).status, 403);
    assert.equal((await fetch(`${base}/mine?patient_id=x`, { headers: headers('teacher') })).status, 400);
  });
  assert.deepEqual(calls, [[actorId, 'estudiante'], [actorId, 'teacher']]);
  assert.deepEqual(Object.keys(contexts[0]).sort(), ['academic_group_id', 'subject_id']);
});

test('repository /mine queries only active linked contexts and projects subject/group identifiers', async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ subject_id: 's', academic_group_id: 'g' }] }; } };
  const repo = new PgEndodonticsSubjectRepository(pool);
  assert.deepEqual(await repo.listMine(actorId, 'estudiante'), [{ subject_id: 's', academic_group_id: 'g' }]);
  assert.deepEqual(await repo.listMine(actorId, 'teacher'), [{ subject_id: 's', academic_group_id: 'g' }]);
  for (const { sql, params } of calls) {
    assert.match(sql, /endodontics_subjects/); assert.match(sql, /revoked_at IS NULL/);
    assert.match(sql, /SELECT DISTINCT h\.subject_id, h\.academic_group_id/);
    assert.deepEqual(params, [actorId]);
    assert.doesNotMatch(sql, /patient_id|patient_name|demographic/i);
  }
});

test('/mine rejects other roles before repository access', async () => {
  let calls = 0;
  await serve({ async listMine() { calls++; return []; } }, async base => {
    assert.equal((await fetch(`${base}/mine`, { headers: headers('admin') })).status, 403);
  });
  assert.equal(calls, 0);
});
