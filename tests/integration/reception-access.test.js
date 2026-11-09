import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import pg from 'pg';
import { createReceptionRouter } from '../../src/modules/reception/infrastructure/routes/reception.routes.ts';
import { PgReceptionAccessRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-access.repository.ts';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';
import { cleanupReceptionTest, observeStarted, releaseAndSettleReceptionOperations } from '../helpers/reception-test-lifecycle.js';

const enabled = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const CAREERS = ['kinesiology', 'odontology'];

function barrier() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise, label, milliseconds = 7000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLockWait(pool, queryPattern) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`, [queryPattern]);
    if (rows[0].count > 0) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`expected PostgreSQL lock wait was not observed for ${queryPattern}`);
}

test('Reception account/grant HTTP paths and scope/revocation serialize on fresh migrated 001-046 database', { skip: !enabled }, async () => {
  const target = await verifyDisposableIntegrationTarget();
  const pool = new pg.Pool({ connectionString: process.env.DISPOSABLE_INTEGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000 });
  let accountId = randomUUID();
  let server;
  let primaryError;
  try {
    const identity = await pool.query(`SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
      inet_server_addr()::text AS address, inet_server_port() AS port`);
    const canonicalAddress = (value) => {
      const normalized = value?.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase() ?? '';
      return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
    };
    assert.deepEqual({ ...identity.rows[0], address: canonicalAddress(identity.rows[0].address) }, {
      name: target.identity.databaseName, oid: target.identity.databaseOid, owner: target.identity.databaseOwner,
      address: canonicalAddress(target.identity.serverAddress), port: target.identity.serverPort,
    });
    assert.equal(canonicalAddress(identity.rows[0].address), canonicalAddress(target.identity.serverAddress));

    const ledger = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    assert.equal(ledger.rowCount, 46);
    assert.equal(ledger.rows.at(-1).name, '046_create_reception_patient_enrollments.sql');
    const privileges = await pool.query("SELECT permission FROM role_permissions WHERE role='reception' ORDER BY permission");
    assert.deepEqual(privileges.rows, [{ permission: 'profile:read' }, { permission: 'reception:careers:read' }, { permission: 'reception:patients:manage' }]);

    await pool.query(`INSERT INTO users (id, username, password_hash, role, email)
      VALUES ($1, 'reception_test_admin', 'synthetic-hash', 'admin', 'reception-admin@example.invalid')`, [ADMIN_ID]);
    const repository = new PgReceptionAccessRepository(pool);
    const authenticate = (req, _res, next) => {
      const reception = req.baseUrl === '/self' || req.get('x-test-role') === 'reception';
      req.auth = { sub: reception ? accountId : ADMIN_ID, role: reception ? 'reception' : 'admin', permissions: ['reception:accounts:write', 'reception:careers:write', 'reception:careers:read'] };
      next();
    };
    const allow = { async authorize() {} };
    const app = express();
    app.use(express.json());
    app.use('/admin', createReceptionRouter({ repository, hasher: { async hash(value) { return `synthetic:${value}`; } }, authenticate,
      getActor: async (req) => req.auth.sub, adminGuard: allow, grantGuard: allow, readGuard: allow }));
    app.use('/self', createReceptionRouter({ surface: 'self', repository, hasher: { async hash(value) { return value; } }, authenticate,
      getActor: async (req) => req.auth.sub, readGuard: allow }));
    app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message }));
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, method = 'GET', body, extraHeaders = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...extraHeaders },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    }

    const deniedProvision = await request('/admin/accounts', 'POST', { username: 'ReceptionDenied', password: 'healthy1234', email: 'denied@example.invalid' }, { 'x-test-role': 'reception' });
    assert.equal(deniedProvision.status, 403);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM users WHERE username='RECEPTIONDENIED' OR email='denied@example.invalid'")).rows[0].count, 0);

    const created = await request('/admin/accounts', 'POST', { username: 'ReceptionTest', password: 'healthy1234', email: 'reception@example.invalid' });
    assert.equal(created.status, 201);
    assert.equal(created.body.role, 'reception');
    assert.equal(Object.hasOwn(created.body, 'passwordHash'), false);
    accountId = created.body.id;
    const none = await request('/self/careers');
    assert.deepEqual(none, { status: 200, body: { careers: [] } });

    const grants = [];
    for (const career of CAREERS) {
      const granted = await request(`/admin/accounts/${accountId}/careers`, 'POST', { career });
      assert.equal(granted.status, 201);
      assert.equal(granted.body.career, career);
      assert.equal(granted.body.granted_by, ADMIN_ID);
      grants.push(granted.body);
      assert.equal((await request(`/admin/accounts/${accountId}/careers`, 'POST', { career })).status, 409);
    }
    assert.deepEqual((await request('/self/careers')).body.careers, CAREERS);
    const revoked = await request(`/admin/career-grants/${grants[0].id}/revoke`, 'POST', {});
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.revoked_by, ADMIN_ID);
    assert.equal((await request(`/admin/career-grants/${grants[0].id}/revoke`, 'POST', {})).body.revoked_at, revoked.body.revoked_at);
    assert.deepEqual((await request('/self/careers')).body.careers, ['odontology']);

    // Scoped callback first: revocation must show an actual PostgreSQL lock wait.
    const scopeEntered = barrier(), releaseScope = barrier();
    const scope = observeStarted(repository.withActiveCareerScope(accountId, 'odontology', async (client) => {
      scopeEntered.resolve();
      await releaseScope.promise;
      await client.query('SELECT 1');
    }));
    let revocation;
    let scopeOutcomes;
    let interleavingError;
    try {
      await bounded(scopeEntered.promise, 'scoped callback entry');
      const activeGrant = (await repository.listGrants(accountId, true)).find((grant) => grant.careerCode === 'odontology');
      revocation = observeStarted(repository.revokeGrant(activeGrant.id, ADMIN_ID));
      await waitForLockWait(pool, 'UPDATE reception_career_grants%');
    } catch (error) {
      interleavingError = error;
    } finally {
      await cleanupReceptionTest([
        () => releaseAndSettleReceptionOperations([() => releaseScope.resolve()], [scope, ...(revocation ? [revocation] : [])])
          .then((outcomes) => { scopeOutcomes = outcomes; }),
      ], interleavingError);
    }
    assert.ok(scopeOutcomes.every((outcome) => outcome.status === 'fulfilled'));
    assert.equal((await repository.listGrants(accountId, true)).some((grant) => grant.careerCode === 'odontology'), false);

    // Revocation owns the grant row first: READ COMMITTED scope lookup must
    // recheck after the lock is released and never invoke its callback.
    const secondGrant = await repository.grantCareer(accountId, 'odontology', ADMIN_ID);
    const blocker = await pool.connect();
    let callbackCalled = false;
    let laterScope;
    let scopeOutcome;
    let blockerCommitted = false;
    let blockerError;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM reception_career_grants WHERE id=$1 FOR UPDATE', [secondGrant.id]);
      laterScope = observeStarted(repository.withActiveCareerScope(accountId, 'odontology', async () => { callbackCalled = true; }));
      await waitForLockWait(pool, 'SELECT g.id FROM reception_career_grants%');
      await blocker.query('UPDATE reception_career_grants SET revoked_by=$2, revoked_at=clock_timestamp() WHERE id=$1', [secondGrant.id, ADMIN_ID]);
      await blocker.query('COMMIT');
      blockerCommitted = true;
    } catch (error) {
      blockerError = error;
    } finally {
      const cleanups = [
        async () => { if (!blockerCommitted) await blocker.query('ROLLBACK'); },
        async () => blocker.release(),
        async () => { if (laterScope) scopeOutcome = await laterScope; },
      ];
      await cleanupReceptionTest(cleanups, blockerError);
    }
    assert.equal(scopeOutcome?.status, 'rejected', 'scope must reject after concurrent revocation');
    assert.match(scopeOutcome.reason.message, /active career scope was not found/);
    assert.equal(callbackCalled, false);

    // Denied grant path must not alter grant history.
    const before = await pool.query('SELECT count(*)::int AS count FROM reception_career_grants WHERE user_id=$1', [accountId]);
    const denied = await request(`/admin/accounts/${randomUUID()}/careers`, 'POST', { career: 'kinesiology' });
    assert.equal(denied.status, 404);
    const after = await pool.query('SELECT count(*)::int AS count FROM reception_career_grants WHERE user_id=$1', [accountId]);
    assert.equal(after.rows[0].count, before.rows[0].count);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanups = [];
    if (server) cleanups.push(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    cleanups.push(() => pool.query('DELETE FROM reception_career_grants WHERE user_id=$1 OR granted_by=$1', [accountId]));
    cleanups.push(() => pool.query('DELETE FROM reception_career_grants WHERE user_id=$1 OR granted_by=$1', [ADMIN_ID]));
    cleanups.push(() => pool.query('DELETE FROM users WHERE id=$1', [accountId]));
    cleanups.push(() => pool.query('DELETE FROM users WHERE id=$1', [ADMIN_ID]));
    cleanups.push(() => pool.end());
    await cleanupReceptionTest(cleanups, primaryError);
  }
});
