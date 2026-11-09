import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { ConflictError } from '../../src/modules/shared/domain/errors.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { createReceptionRouter } from '../../src/modules/reception/infrastructure/routes/reception.routes.ts';

const ADMIN = '40000000-0000-4000-8000-000000000001';
const USER = '40000000-0000-4000-8000-000000000002';
const initial = { username: ' Reception1 ', password: 'healthy1234', email: ' frontdesk@example.com ' };

async function withServer(repository, run, { role = 'admin', permissions = ['reception:accounts:write', 'reception:careers:write', 'reception:careers:read'] } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { userId: ADMIN, role, permissions }; next(); });
  app.use('/auth', createReceptionRouter({ repository, hasher: { async hash(value) { repository.hashes++; return `hash:${value}`; } } }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/auth`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function fakeRepository() {
  const state = { creates: [], grants: [], hashes: 0, grantCalls: 0, revokes: 0, duplicateUser: false };
  return Object.assign(state, {
    async createAccount(user) {
      state.creates.push(user);
      if (state.duplicateUser) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_username_key' });
      return { ...user, id: USER, createdAt: '2026-06-01T12:00:00Z', toJSON() { return { id: USER, username: user.username, role: user.role, email: user.email, createdAt: this.createdAt }; } };
    },
    async grantCareer(userId, careerCode, actorId) {
      state.grantCalls++;
      if (state.grants.some((g) => g.careerCode === careerCode && !g.revokedAt)) throw new ConflictError('career grant is already active');
      const grant = { id: `50000000-0000-4000-8000-${String(state.grants.length + 1).padStart(12, '0')}`, userId, careerCode, grantedBy: actorId, grantedAt: '2026-06-01T12:00:00Z', revokedBy: null, revokedAt: null };
      state.grants.push(grant); return grant;
    },
    async listGrants(userId, activeOnly = false) { return state.grants.filter((g) => g.userId === userId && (!activeOnly || !g.revokedAt)); },
    async revokeGrant(id, actorId) {
      state.revokes++;
      const grant = state.grants.find((g) => g.id === id);
      if (!grant) throw Object.assign(new Error('missing'), { status: 404 });
      if (!grant.revokedAt) { grant.revokedAt = '2026-06-02T12:00:00Z'; grant.revokedBy = actorId; }
      return grant;
    },
  });
}

test('admin-only Reception account creation normalizes identity, hashes password, and rejects invalid or duplicate input without writes', async () => {
  const repo = fakeRepository();
  await withServer(repo, async (base) => {
    for (const body of [{ ...initial, username: 'not valid' }, { ...initial, email: 'bad' }, { ...initial, password: 'short' }]) {
      const response = await fetch(`${base}/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
    assert.equal(repo.creates.length, 0);
    assert.equal(repo.hashes, 0);
    repo.duplicateUser = true;
    const duplicate = await fetch(`${base}/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(initial) });
    assert.equal(duplicate.status, 409);
    assert.equal(repo.creates.length, 1);
    assert.equal(repo.creates[0].role, 'reception');
    assert.equal(repo.creates[0].username, 'RECEPTION1');
    assert.equal(repo.creates[0].email, 'frontdesk@example.com');
    assert.equal(repo.creates[0].passwordHash, 'hash:healthy1234');
  });
  await withServer(repo, async (base) => {
    assert.equal((await fetch(`${base}/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(initial) })).status, 403);
  }, { role: 'teacher' });
});

test('both admin role and dedicated permission protect grants; active duplicate, two-career grant, listing, and idempotent audited revoke', async () => {
  const repo = fakeRepository();
  await withServer(repo, async (base) => {
    const response = await fetch(`${base}/accounts/${USER}/careers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology' }) });
    assert.equal(response.status, 403);
  }, { permissions: [] });
  assert.equal(repo.grantCalls, 0);
  await withServer(repo, async (base) => {
    const post = (body) => fetch(`${base}/accounts/${USER}/careers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const grants = [];
    for (const career of ['kinesiology', 'odontology']) {
      const response = await fetch(`${base}/accounts/${USER}/careers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ career }) });
      assert.equal(response.status, 201);
      grants.push(await response.json());
    }
    assert.deepEqual(grants.map((g) => g.career), ['kinesiology', 'odontology']);
    assert.equal((await post({ career: 'kinesiology' })).status, 409);
    assert.equal((await post({ career: 'unknown' })).status, 400);
    const listed = await fetch(`${base}/accounts/${USER}/careers`);
    assert.deepEqual((await listed.json()).items.map((g) => g.career), ['kinesiology', 'odontology']);
    const revokeUrl = `${base}/career-grants/${grants[0].id}/revoke`;
    const first = await fetch(revokeUrl, { method: 'POST' });
    const firstBody = await first.json();
    const second = await fetch(revokeUrl, { method: 'POST' });
    assert.deepEqual(await second.json(), firstBody);
    assert.equal(firstBody.revoked_by, ADMIN);
    assert.equal(firstBody.revoked_at, '2026-06-02T12:00:00.000Z');
    assert.equal(repo.revokes, 2);
  });
});
