import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { ConflictError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';
import { createActiveRoleAdminRouter } from '../../src/modules/auth/infrastructure/routes/active-role.routes.ts';

const ADMIN = '40000000-0000-4000-8000-000000000001';
const STUDENT = '40000000-0000-4000-8000-000000000002';
const GRANT = '50000000-0000-4000-8000-000000000001';

async function withServer(repository, run, { role = 'admin', permissions = ['reception:accounts:write'] } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { userId: ADMIN, role, permissions }; next(); });
  app.use('/auth', createActiveRoleAdminRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/auth`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function fakeRepository() {
  const state = { candidates: [{ id: STUDENT, username: 'STUDENT1', email: 'student@example.test' }], grants: [], calls: [] };
  return Object.assign(state, {
    async searchStudentCandidates(input) { state.calls.push(['search', input]); return state.candidates; },
    async listReceptionRoleGrants(userId) { state.calls.push(['list', userId]); return state.grants.filter(grant => grant.userId === userId); },
    async grantReceptionRole(userId, actorId) {
      state.calls.push(['grant', userId, actorId]);
      if (!state.candidates.some(candidate => candidate.id === userId)) throw new NotFoundError('Student account was not found');
      if (state.grants.some(grant => grant.userId === userId && !grant.revokedAt)) throw new ConflictError('Reception role is already active');
      const grant = { id: GRANT, userId, role: 'reception', grantedBy: actorId, grantedAt: '2026-06-01T12:00:00Z', revokedBy: null, revokedAt: null };
      state.grants.push(grant); return grant;
    },
    async revokeReceptionRoleGrant(grantId, actorId) {
      state.calls.push(['revoke', grantId, actorId]);
      const grant = state.grants.find(item => item.id === grantId);
      if (!grant) throw new NotFoundError('Reception role grant was not found');
      if (!grant.revokedAt) { grant.revokedBy = actorId; grant.revokedAt = '2026-06-02T12:00:00Z'; }
      return grant;
    },
  });
}

const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('student candidates are bounded, literal, private, and reject invalid query grammar before repository access', async () => {
  const repo = fakeRepository();
  await withServer(repo, async base => {
    assert.deepEqual(await (await fetch(`${base}/reception-role-candidates?q=%20STUDENT%20`)).json(), {
      items: [{ id: STUDENT, username: 'STUDENT1', email: 'student@example.test' }], limit: 20, offset: 0,
    });
    assert.deepEqual(repo.calls[0], ['search', { q: 'STUDENT', limit: 20, offset: 0 }]);
    const before = repo.calls.length;
    for (const query of ['', '?q=%20%20', '?q=x&x=1', '?q=x&q=y', '?q='+ 'x'.repeat(101), '?q[x]=x', '?q=x&limit=101', '?q=x&offset=-1']) {
      const response = await fetch(`${base}/reception-role-candidates${query}`);
      assert.equal(response.status, 400, query);
    }
    assert.equal(repo.calls.length, before);
  });
  const callsBeforeDenied = repo.calls.length;
  await withServer(repo, async base => {
    const response = await fetch(`${base}/reception-role-candidates?q=student`);
    assert.equal(response.status, 403);
    assert.equal(repo.calls.length, callsBeforeDenied);
  }, { role: 'teacher' });
  await withServer(repo, async base => {
    const response = await fetch(`${base}/reception-role-candidates?q=student`);
    assert.equal(response.status, 403);
    assert.equal(repo.calls.length, callsBeforeDenied);
  }, { permissions: [] });
});

test('role history, audited grant and exact-grant idempotent revoke preserve response keys and reject invalid input without mutation', async () => {
  const repo = fakeRepository();
  await withServer(repo, async base => {
    const invalidId = await fetch(`${base}/accounts/not-a-uuid/reception-role`);
    assert.equal(invalidId.status, 400);
    const invalidBody = await fetch(`${base}/accounts/${STUDENT}/reception-role`, json({ role: 'admin' }));
    assert.equal(invalidBody.status, 400);
    assert.deepEqual(repo.calls, []);

    const granted = await fetch(`${base}/accounts/${STUDENT}/reception-role`, { method: 'POST' });
    assert.equal(granted.status, 201);
    const body = await granted.json();
    assert.deepEqual(Object.keys(body).sort(), ['granted_at', 'granted_by', 'id', 'revoked_at', 'revoked_by', 'role', 'user_id']);
    assert.deepEqual(body, { id: GRANT, user_id: STUDENT, role: 'reception', granted_by: ADMIN, granted_at: '2026-06-01T12:00:00.000Z', revoked_by: null, revoked_at: null });
    assert.equal((await fetch(`${base}/accounts/${STUDENT}/reception-role`, json({}))).status, 409);
    const history = await fetch(`${base}/accounts/${STUDENT}/reception-role`);
    assert.deepEqual((await history.json()).items, [body]);

    const revokeUrl = `${base}/reception-role-grants/${GRANT}/revoke`;
    const first = await fetch(revokeUrl, { method: 'POST' });
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    const replay = await fetch(revokeUrl, { method: 'POST' });
    assert.deepEqual(await replay.json(), firstBody);
    assert.equal(repo.calls.filter(call => call[0] === 'revoke').length, 2);
    assert.equal((await fetch(`${base}/reception-role-grants/not-a-uuid/revoke`, { method: 'POST' })).status, 400);
  });
});
