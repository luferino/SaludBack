import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import config from '../../src/config.ts';
import { createApp } from '../../src/app.ts';
import { BcryptHasher } from '../../src/modules/auth/infrastructure/services/bcrypt-hasher.service.ts';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { PgPermissionMatrixRepository } from '../../src/modules/auth/infrastructure/repositories/pg-permission-matrix.repository.ts';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const enabled = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
const TIMEOUT = 7000;
let pool;

before(async () => {
  if (!enabled) return;
  await verifyDisposableIntegrationTarget();
  pool = new pg.Pool({ connectionString: process.env.DISPOSABLE_INTEGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 2000 });
});

after(async () => { if (pool) await pool.end(); });

async function waitForLockWait(pattern, expected = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1`, [pattern]);
    if (rows[0].count >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`PostgreSQL lock wait not observed for ${pattern}`);
}

async function request(base, path, method = 'GET', token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

function registration(documento) {
  return { career: 'kinesiology', documento, nombres: 'Synthetic', apellidos: 'RoleGrant',
    fecha_nacimiento: '1990-01-02', email: 'rolegrant@example.invalid', celular: '555', sexo: 'F', direccion: 'Synthetic' };
}

test('real JWT active-role grant, career isolation, exact revocation, replay and lock ordering', { skip: !enabled }, async () => {
  const adminId = randomUUID(), studentId = randomUUID(), legacyReceptionId = randomUUID();
  const adminName = `ROLEADMIN${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const studentName = `ROLESTUDENT${randomUUID().replaceAll('-', '').slice(0, 16)}`.toUpperCase();
  const legacyReceptionName = `LEGACYRECEPTION${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const documento = String(10000000 + Math.floor(Math.random() * 89999999));
  const tokenService = new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn });
  const matrixReader = new PgPermissionMatrixRepository(pool);
  const hasher = new BcryptHasher(config.bcryptCost);
  const password = 'RoleGrant1234';
  let server;
  let studentToken;
  let oldReceptionToken;
  let currentReceptionToken;
  let oldGrantId;
  let currentGrantId;
  let patientId;
  let rowLock;
  let blocker;
  try {
    const hash = await hasher.hash(password);
    await pool.query(`INSERT INTO users(id,username,password_hash,role,email) VALUES
      ($1,$2,'synthetic-admin','admin',NULL),($3,$4,$5,'estudiante',$6),($7,$8,'synthetic-primary-reception','reception',NULL)`,
    [adminId, adminName, studentId, studentName, hash, `${studentName.toLowerCase()}@example.invalid`, legacyReceptionId, legacyReceptionName]);
    const adminToken = await tokenService.sign({ sub: adminId, username: adminName, role: 'admin', permissions: [] });
    server = createServer(createApp(pool));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const login = await request(base, '/auth/login', 'POST', undefined, { username: studentName.toLowerCase(), password });
    assert.equal(login.status, 200);
    assert.deepEqual(Object.keys(login.body), ['token']);
    studentToken = login.body.token;
    const loginClaims = jwt.decode(studentToken);
    assert.equal(loginClaims.sub, studentId);
    assert.equal(loginClaims.username, studentName);
    assert.equal(loginClaims.role, 'estudiante');
    assert.equal(Object.hasOwn(loginClaims, 'role_grant_id'), false);

    const me = await request(base, '/auth/me', 'GET', studentToken);
    assert.deepEqual(me, { status: 200, body: { username: studentName, email: `${studentName.toLowerCase()}@example.invalid`, role: 'estudiante' } });
    assert.deepEqual(Object.keys(me.body).sort(), ['email', 'role', 'username']);

    const candidates = await request(base, `/auth/reception-role-candidates?q=${encodeURIComponent(studentName.toLowerCase())}`, 'GET', adminToken);
    assert.equal(candidates.status, 200);
    assert.deepEqual(Object.keys(candidates.body.items[0]).sort(), ['email', 'id', 'username']);
    assert.equal(candidates.body.items[0].id, studentId);
    assert.equal(Object.hasOwn(candidates.body.items[0], 'password_hash'), false);

    const grantResponse = await request(base, `/auth/accounts/${studentId}/reception-role`, 'POST', adminToken, {});
    assert.equal(grantResponse.status, 201);
    const firstGrant = grantResponse.body;
    oldGrantId = firstGrant.id;
    assert.deepEqual(Object.keys(firstGrant).sort(), ['granted_at', 'granted_by', 'id', 'revoked_at', 'revoked_by', 'role', 'user_id']);
    assert.equal(firstGrant.role, 'reception');
    assert.equal(firstGrant.user_id, studentId);
    assert.equal(firstGrant.granted_by, adminId);

    const discovered = await request(base, '/auth/roles', 'GET', studentToken);
    assert.deepEqual(discovered, { status: 200, body: { active_role: 'estudiante', available_roles: ['estudiante', 'reception'] } });
    const primaryStillWorks = await request(base, '/auth/roles', 'GET', studentToken);
    assert.equal(primaryStillWorks.status, 200);
    const primaryCannotUseReception = await request(base, '/reception/patients?career=kinesiology', 'GET', studentToken);
    assert.equal(primaryCannotUseReception.status, 403);
    assert.equal(primaryCannotUseReception.body.error.code, 'FORBIDDEN');

    const switched = await request(base, '/auth/active-role', 'POST', studentToken, { role: 'reception' });
    assert.equal(switched.status, 200);
    oldReceptionToken = switched.body.token;
    const oldClaims = jwt.decode(oldReceptionToken);
    assert.equal(oldClaims.sub, loginClaims.sub);
    assert.equal(oldClaims.username, loginClaims.username);
    assert.equal(oldClaims.role, 'reception');
    assert.equal(oldClaims.role_grant_id, oldGrantId);
    const receptionPermissions = await matrixReader.permissionsForRole('reception');
    assert.deepEqual(oldClaims.permissions, [...receptionPermissions]);
    assert.deepEqual(new Set(oldClaims.permissions), new Set(receptionPermissions));
    const meWhileReceptionActive = await request(base, '/auth/me', 'GET', oldReceptionToken);
    assert.deepEqual(meWhileReceptionActive.body, { username: studentName, email: `${studentName.toLowerCase()}@example.invalid`, role: 'estudiante' });
    const noClinicalWrite = await request(base, '/patient-assignments', 'POST', oldReceptionToken, {});
    assert.equal(noClinicalWrite.status, 403);

    const careerAbsent = await request(base, '/reception/patients?career=kinesiology', 'GET', oldReceptionToken);
    assert.equal(careerAbsent.status, 404);
    assert.equal(careerAbsent.body.error.code, 'NOT_FOUND');
    const careerGrant = await request(base, `/auth/accounts/${studentId}/careers`, 'POST', adminToken, { career: 'kinesiology' });
    assert.equal(careerGrant.status, 201);
    const legacyCareer = await request(base, `/auth/accounts/${legacyReceptionId}/careers`, 'POST', adminToken, { career: 'kinesiology' });
    assert.equal(legacyCareer.status, 201);
    const legacyReceptionToken = await tokenService.sign({ sub: legacyReceptionId, username: legacyReceptionName,
      role: 'reception', permissions: [] });
    assert.equal(Object.hasOwn(jwt.decode(legacyReceptionToken), 'role_grant_id'), false);
    assert.equal((await request(base, '/reception/patients?career=kinesiology', 'GET', legacyReceptionToken)).status, 200);
    const dualAccount = await request(base, `/auth/accounts?q=${encodeURIComponent(studentName)}`, 'GET', adminToken);
    assert.equal(dualAccount.status, 200);
    assert.deepEqual(Object.keys(dualAccount.body.items[0]).sort(), ['active_careers', 'email', 'id', 'username']);
    assert.deepEqual(dualAccount.body.items[0].active_careers, ['kinesiology']);

    const listPatients = await request(base, '/reception/patients?career=kinesiology', 'GET', oldReceptionToken);
    assert.deepEqual(listPatients, { status: 200, body: { items: [] } });
    const created = await request(base, '/reception/patients/register', 'POST', oldReceptionToken, registration(documento));
    assert.equal(created.status, 201);
    patientId = created.body.id;
    assert.equal(created.body.documento, documento);

    const revoke = await request(base, `/auth/reception-role-grants/${oldGrantId}/revoke`, 'POST', adminToken, {});
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.revoked_by, adminId);
    const careerAfterRevoke = await pool.query('SELECT count(*)::int AS n FROM reception_career_grants WHERE user_id=$1 AND revoked_at IS NULL', [studentId]);
    assert.equal(careerAfterRevoke.rows[0].n, 0);
    const staleAfterRevoke = await request(base, '/auth/roles', 'GET', oldReceptionToken);
    assert.equal(staleAfterRevoke.status, 401);
    assert.equal(staleAfterRevoke.body.error.code, 'UNAUTHORIZED');

    const regrant = await request(base, `/auth/accounts/${studentId}/reception-role`, 'POST', adminToken, {});
    assert.equal(regrant.status, 201);
    currentGrantId = regrant.body.id;
    assert.notEqual(currentGrantId, oldGrantId);
    const staleAfterRegrant = await request(base, '/auth/roles', 'GET', oldReceptionToken);
    assert.equal(staleAfterRegrant.status, 401);
    const replay = await request(base, `/auth/reception-role-grants/${oldGrantId}/revoke`, 'POST', adminToken, {});
    assert.deepEqual(replay.body, revoke.body);
    const stillActive = await pool.query(`SELECT
      (SELECT count(*)::int FROM user_role_grants WHERE id=$1 AND revoked_at IS NULL) AS roles,
      (SELECT count(*)::int FROM reception_career_grants WHERE user_id=$2 AND revoked_at IS NULL) AS careers`, [currentGrantId, studentId]);
    assert.deepEqual(stillActive.rows[0], { roles: 1, careers: 0 });

    const newSwitch = await request(base, '/auth/active-role', 'POST', studentToken, { role: 'reception' });
    assert.equal(newSwitch.status, 200);
    currentReceptionToken = newSwitch.body.token;
    assert.equal(jwt.decode(currentReceptionToken).role_grant_id, currentGrantId);
    const careerStillSeparate = await request(base, '/reception/patients?career=kinesiology', 'GET', currentReceptionToken);
    assert.equal(careerStillSeparate.status, 404);
    const careerRegrant = await request(base, `/auth/accounts/${studentId}/careers`, 'POST', adminToken, { career: 'kinesiology' });
    assert.equal(careerRegrant.status, 201);
    assert.equal((await request(base, '/reception/patients?career=kinesiology', 'GET', currentReceptionToken)).status, 200);
    const replayAfterNewCareer = await request(base, `/auth/reception-role-grants/${oldGrantId}/revoke`, 'POST', adminToken, {});
    assert.deepEqual(replayAfterNewCareer.body, revoke.body);
    const laterPeriods = await pool.query(`SELECT
      (SELECT count(*)::int FROM user_role_grants WHERE id=$1 AND revoked_at IS NULL) AS roles,
      (SELECT count(*)::int FROM reception_career_grants WHERE user_id=$2 AND revoked_at IS NULL) AS careers`, [currentGrantId, studentId]);
    assert.deepEqual(laterPeriods.rows[0], { roles: 1, careers: 1 });

    // A patient row lock holds the scoped write after user/grant/career locks. Revocation must wait,
    // allow this already-authorized write to commit, then revoke role and career in order.
    blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE', [patientId]);
    const patchPromise = request(base, `/reception/patients/${patientId}?career=kinesiology`, 'PATCH', currentReceptionToken, { celular: '777' });
    await waitForLockWait('%FROM patients p JOIN reception_patient_enrollments%WHERE p.id=$1%FOR UPDATE OF p%');
    const revokeAfterWritePromise = request(base, `/auth/reception-role-grants/${currentGrantId}/revoke`, 'POST', adminToken, {});
    await waitForLockWait('%SELECT id FROM users WHERE id=$1 FOR UPDATE%');
    await blocker.query('COMMIT'); blocker.release(); blocker = null;
    const [patchResult, revokeAfterWrite] = await Promise.all([patchPromise, revokeAfterWritePromise]);
    assert.equal(patchResult.status, 200);
    assert.equal(revokeAfterWrite.status, 200);
    const persistedContact = await pool.query('SELECT celular FROM patients WHERE id=$1', [patientId]);
    assert.equal(persistedContact.rows[0].celular, '777');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM reception_career_grants WHERE user_id=$1 AND revoked_at IS NULL', [studentId])).rows[0].n, 0);

    // If revocation queues before a protected write, middleware may have observed the live token,
    // but the scoped transaction must recheck the exact grant after acquiring the user lock.
    const staleRaceGrant = await request(base, `/auth/accounts/${studentId}/reception-role`, 'POST', adminToken, {});
    assert.equal(staleRaceGrant.status, 201);
    const staleRaceCareer = await request(base, `/auth/accounts/${studentId}/careers`, 'POST', adminToken, { career: 'kinesiology' });
    assert.equal(staleRaceCareer.status, 201);
    const staleRaceSwitch = await request(base, '/auth/active-role', 'POST', studentToken, { role: 'reception' });
    assert.equal(staleRaceSwitch.status, 200);
    const staleRaceToken = staleRaceSwitch.body.token;
    rowLock = await pool.connect();
    await rowLock.query('BEGIN');
    await rowLock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [studentId]);
    const staleRevoke = request(base, `/auth/reception-role-grants/${staleRaceGrant.body.id}/revoke`, 'POST', adminToken, {});
    await waitForLockWait('%FROM users WHERE id%FOR UPDATE%');
    const staleWrite = request(base, `/reception/patients/${patientId}?career=kinesiology`, 'PATCH', staleRaceToken, { celular: '888' });
    await waitForLockWait('%FROM users WHERE id%FOR UPDATE%', 2);
    await rowLock.query('COMMIT'); rowLock.release(); rowLock = null;
    const [staleRevokeResult, staleWriteResult] = await Promise.all([staleRevoke, staleWrite]);
    assert.equal(staleRevokeResult.status, 200);
    assert.equal(staleWriteResult.status, 401);
    assert.equal(staleWriteResult.body.error.code, 'UNAUTHORIZED');
    const unchangedAfterStaleWrite = await pool.query('SELECT celular FROM patients WHERE id=$1', [patientId]);
    assert.equal(unchangedAfterStaleWrite.rows[0].celular, '777');

    // Career grant and role revoke contend on the same user lock. Revoke queues first,
    // so the following career grant must see the revoked role and cannot create a career.
    const nextGrant = await request(base, `/auth/accounts/${studentId}/reception-role`, 'POST', adminToken, {});
    assert.equal(nextGrant.status, 201);
    const careerForRace = await request(base, `/auth/accounts/${studentId}/careers`, 'POST', adminToken, { career: 'kinesiology' });
    assert.equal(careerForRace.status, 201);
    const nextRoleId = nextGrant.body.id;
    rowLock = await pool.connect();
    await rowLock.query('BEGIN');
    await rowLock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [studentId]);
    const revokeRace = request(base, `/auth/reception-role-grants/${nextRoleId}/revoke`, 'POST', adminToken, {});
    await waitForLockWait('%SELECT id FROM users WHERE id=$1 FOR UPDATE%');
    const careerRace = request(base, `/auth/accounts/${studentId}/careers`, 'POST', adminToken, { career: 'odontology' });
    await waitForLockWait('%FROM users WHERE id=$1 FOR UPDATE%', 2);
    await rowLock.query('COMMIT'); rowLock.release(); rowLock = null;
    const [revokeRaceResult, careerRaceResult] = await Promise.all([revokeRace, careerRace]);
    assert.equal(revokeRaceResult.status, 200);
    assert.equal(careerRaceResult.status, 404);
    const activeCareers = await pool.query('SELECT count(*)::int AS n FROM reception_career_grants WHERE user_id=$1 AND revoked_at IS NULL', [studentId]);
    assert.equal(activeCareers.rows[0].n, 0);

    const grantHistory = await request(base, `/auth/accounts/${studentId}/reception-role`, 'GET', adminToken);
    assert.equal(grantHistory.status, 200);
    assert.equal(grantHistory.body.items.length, 4);
    assert.deepEqual(grantHistory.body.items.map(item => item.id), [oldGrantId, currentGrantId, staleRaceGrant.body.id, nextRoleId]);
  } finally {
    if (rowLock) { try { await rowLock.query('ROLLBACK'); } finally { rowLock.release(); } }
    if (blocker) { try { await blocker.query('ROLLBACK'); } finally { blocker.release(); } }
    if (server) await new Promise(resolve => server.close(() => resolve()));
    if (pool) {
      if (patientId) {
        await pool.query('DELETE FROM reception_patient_enrollments WHERE patient_id=$1', [patientId]);
        await pool.query('DELETE FROM patients WHERE id=$1', [patientId]);
      }
      await pool.query('DELETE FROM reception_career_grants WHERE user_id=$1 OR granted_by=$2', [studentId, adminId]);
      await pool.query('DELETE FROM user_role_grants WHERE user_id=$1 OR granted_by=$2', [studentId, adminId]);
      await pool.query('DELETE FROM users WHERE id=$1 OR id=$2 OR id=$3', [studentId, adminId, legacyReceptionId]);
    }
  }
});
