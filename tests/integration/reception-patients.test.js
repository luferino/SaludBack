import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';
import { PgReceptionPatientRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-patient.repository.ts';
import { cleanupReceptionTest, observeStarted, releaseAndSettleReceptionOperations } from '../helpers/reception-test-lifecycle.js';

const enabled = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
const sleepTurn = () => new Promise(resolve => setImmediate(resolve));
async function waitBounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function waitForLockWait(pool, pattern) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1`, [pattern]);
    if (rows[0].count > 0) return;
    await sleepTurn();
  }
  assert.fail(`expected lock wait was not observed for ${pattern}`);
}

test('Reception patient HTTP operations isolate enrollment, atomically register identity, and serialize contact edits', { skip: !enabled, timeout: 20000 }, async () => {
  const target = await verifyDisposableIntegrationTarget();
  const [{ createApp }, { JwtTokenService }, { default: config }] = await Promise.all([
    import('../../src/app.ts'),
    import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
    import('../../src/config.ts'),
  ]);
  const pool = new pg.Pool({ connectionString: process.env.DISPOSABLE_INTEGRATION_DATABASE_URL,
    max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000,
    options: '-c search_path=pg_catalog,public,pg_temp -c lock_timeout=5000 -c idle_in_transaction_session_timeout=10000' });
  const adminId = randomUUID(), userA = randomUUID(), userB = randomUUID(), patientId = randomUUID(), patientUnenrolledId = randomUUID();
  let createdPatientId;
  const usernames = [adminId, userA, userB].map(id => `reception_${id.replaceAll('-', '')}`);
  let server;
  let primaryError;
  let originalFindEnrolled;
  let originalFindPatientByDocumento;
  let originalEnrollExisting;
  let patientRepositoryType;
  let failNextEnrollment = false;
  let unblockFirst;
  let releaseRegistrationLookups;
  let firstEntered;
  const pendingOperations = [];
  const firstEnteredPromise = new Promise(resolve => { firstEntered = resolve; });
  try {
    const identity = await pool.query(`SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
      inet_server_addr()::text AS address, inet_server_port() AS port`);
    const norm = value => value?.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase() ?? '';
    assert.deepEqual({ ...identity.rows[0], address: norm(identity.rows[0].address) }, {
      name: target.identity.databaseName, oid: target.identity.databaseOid, owner: target.identity.databaseOwner,
      address: norm(target.identity.serverAddress), port: target.identity.serverPort,
    });
    const ledger = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    assert.equal(ledger.rowCount, 47);
    assert.equal(ledger.rows.at(-1).name, '047_seed_reception_availability_permissions.sql');

    await pool.query(`INSERT INTO users(id,username,password_hash,role) VALUES
      ($1,$2,'synthetic','admin'),($3,$4,'synthetic','reception'),($5,$6,'synthetic','reception')`,
    [adminId, usernames[0], userA, usernames[1], userB, usernames[2]]);
    await pool.query(`INSERT INTO reception_career_grants(user_id,career_id,granted_by)
      SELECT $1::uuid,id,$3::uuid FROM careers WHERE code='kinesiology' UNION ALL
      SELECT $2::uuid,id,$3::uuid FROM careers WHERE code='kinesiology' UNION ALL
      SELECT $2::uuid,id,$3::uuid FROM careers WHERE code='odontology'`, [userA, userB, adminId]);
    await pool.query(`INSERT INTO patients(id,documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion,created_by)
      VALUES($1,'35123456','Ana','Perez','1990-01-02','ana@example.com','111','F','Original',NULL),
            ($2,'35123459','Unenrolled','Fixture','1993-03-04','unenrolled@example.com','333','F','Private',NULL)`, [patientId, patientUnenrolledId]);
    await pool.query(`INSERT INTO reception_patient_enrollments(patient_id,career_id)
      SELECT $1::uuid,id FROM careers WHERE code='odontology'`, [patientId]);

    const tokenService = new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid,
      previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn });
    const tokenA = await tokenService.sign({ sub: userA, username: usernames[1], role: 'reception', permissions: [] });
    const tokenB = await tokenService.sign({ sub: userB, username: usernames[2], role: 'reception', permissions: [] });
    const adminToken = await tokenService.sign({ sub: adminId, username: usernames[0], role: 'admin', permissions: [] });
    originalFindEnrolled = PgReceptionPatientRepository.prototype.findEnrolled;
    originalFindPatientByDocumento = PgReceptionPatientRepository.prototype.findPatientByDocumento;
    originalEnrollExisting = PgReceptionPatientRepository.prototype.enrollExisting;
    patientRepositoryType = PgReceptionPatientRepository;
    let registrationLookupCount = 0;
    const registrationLookupBarrier = new Promise(resolve => { releaseRegistrationLookups = resolve; });
    PgReceptionPatientRepository.prototype.findPatientByDocumento = async function (db, documento) {
      const found = await originalFindPatientByDocumento.call(this, db, documento);
      if (documento === '35123458') {
        registrationLookupCount += 1;
        if (registrationLookupCount === 2) releaseRegistrationLookups();
        await registrationLookupBarrier;
      }
      return found;
    };
    PgReceptionPatientRepository.prototype.enrollExisting = async function (db, id, career) {
      if (failNextEnrollment) { failNextEnrollment = false; throw new Error('synthetic enrollment insertion failure'); }
      return originalEnrollExisting.call(this, db, id, career);
    };
    let paused = false;
    let contactPauseEnabled = false;
    const barrier = new Promise(resolve => { unblockFirst = resolve; });
    PgReceptionPatientRepository.prototype.findEnrolled = async function (db, id, career) {
      const patient = await originalFindEnrolled.call(this, db, id, career);
      if (contactPauseEnabled && !paused && id === patientId && career === 'kinesiology') {
        paused = true;
        firstEntered();
        await barrier;
      }
      return patient;
    };
    server = createApp(pool).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const tokens = new Map([[userA, tokenA], [userB, tokenB], [adminId, adminToken]]);
    const requestUrl = (userId, path, method = 'GET', body) => fetch(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${tokens.get(userId)}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const request = (userId, path, method = 'GET', body) => requestUrl(userId, `/reception/patients${path}`, method, body);

    const initialKList = await request(userA, '?career=kinesiology');
    assert.equal(initialKList.status, 200);
    assert.deepEqual((await initialKList.json()).items, []);
    assert.equal((await request(userA, `/${patientId}?career=kinesiology`)).status, 404);
    assert.equal((await request(userA, `/${patientUnenrolledId}?career=kinesiology`)).status, 404);
    const initialOList = await request(userB, '?career=odontology');
    assert.deepEqual((await initialOList.json()).items.map(item => item.id), [patientId]);

    const match = await request(userA, '/match', 'POST', { career: 'kinesiology', documento: '35123456' });
    assert.equal(match.status, 200);
    assert.deepEqual(await match.json(), { match: true, patient_id: patientId });
    const beforeMismatch = await Promise.all([
      pool.query('SELECT documento,nombres,apellidos,email,celular,direccion,created_by,updated_by,updated_at FROM patients WHERE id=$1', [patientId]),
      pool.query('SELECT career_id FROM reception_patient_enrollments WHERE patient_id=$1 ORDER BY career_id', [patientId]),
    ]);
    const mismatchedReuse = await request(userA, '/reuse', 'POST', { career: 'kinesiology', patient_id: patientId, documento: '35123459' });
    assert.equal(mismatchedReuse.status, 404);
    const afterMismatch = await Promise.all([
      pool.query('SELECT documento,nombres,apellidos,email,celular,direccion,created_by,updated_by,updated_at FROM patients WHERE id=$1', [patientId]),
      pool.query('SELECT career_id FROM reception_patient_enrollments WHERE patient_id=$1 ORDER BY career_id', [patientId]),
    ]);
    assert.deepEqual(afterMismatch.map(result => result.rows), beforeMismatch.map(result => result.rows));
    const reuse = await request(userA, '/reuse', 'POST', { career: 'kinesiology', patient_id: patientId, documento: '35123456' });
    assert.equal(reuse.status, 200);
    assert.deepEqual(await reuse.json(), { patient_id: patientId, career: 'kinesiology', enrolled: true });
    const reuseAgain = await request(userA, '/reuse', 'POST', { career: 'kinesiology', patient_id: patientId, documento: '35123456' });
    assert.equal(reuseAgain.status, 200);
    const reusedEnrollment = await pool.query(`SELECT c.code FROM reception_patient_enrollments e JOIN careers c ON c.id=e.career_id WHERE e.patient_id=$1 ORDER BY c.code`, [patientId]);
    assert.deepEqual(reusedEnrollment.rows.map(row => row.code), ['kinesiology', 'odontology']);
    const reusedPatient = await pool.query('SELECT documento,nombres,apellidos,email,celular,direccion,created_by,updated_by,updated_at FROM patients WHERE id=$1', [patientId]);
    assert.deepEqual(reusedPatient.rows[0], { documento: '35123456', nombres: 'Ana', apellidos: 'Perez', email: 'ana@example.com', celular: '111', direccion: 'Original', created_by: null, updated_by: null, updated_at: null });
    const enrolledList = await request(userA, '/?career=kinesiology');
    assert.equal(enrolledList.status, 200);
    assert.deepEqual((await enrolledList.json()).items.map(item => item.id), [patientId]);
    assert.equal((await request(userA, `/${patientUnenrolledId}?career=kinesiology`)).status, 404);
    const enrolledRead = await request(userA, `/${patientId}?career=kinesiology`);
    assert.equal(enrolledRead.status, 200);
    const enrolledBody = await enrolledRead.json();
    assert.deepEqual(Object.keys(enrolledBody).sort(), ['id','documento','nombres','apellidos','fecha_nacimiento','email','celular','sexo','direccion'].sort());
    assert.equal(enrolledBody.nombres, 'Ana');
    const otherCareerRead = await request(userB, `/${patientId}?career=odontology`);
    assert.equal(otherCareerRead.status, 200);
    assert.equal((await otherCareerRead.json()).id, patientId);
    const foreignScope = await request(userA, '/?career=odontology');
    assert.equal(foreignScope.status, 404);
    const beforeRejectedPatch = await pool.query('SELECT documento,nombres,apellidos,email,celular,direccion,updated_by,updated_at FROM patients WHERE id=$1', [patientId]);
    const identityEdit = await request(userA, `/${patientId}?career=kinesiology`, 'PATCH', { nombres: 'Forbidden' });
    assert.equal(identityEdit.status, 400);
    const invalidContact = await request(userA, `/${patientId}?career=kinesiology`, 'PATCH', { email: 'bad-email' });
    assert.equal(invalidContact.status, 400);
    const afterRejectedPatch = await pool.query('SELECT documento,nombres,apellidos,email,celular,direccion,updated_by,updated_at FROM patients WHERE id=$1', [patientId]);
    assert.deepEqual(afterRejectedPatch.rows, beforeRejectedPatch.rows);
    failNextEnrollment = true;
    const rollback = await request(userA, '/register', 'POST', { career: 'kinesiology', documento: '35123460', nombres: 'Rollback', apellidos: 'Fixture', fecha_nacimiento: '1991-02-03', email: 'rollback@example.com', celular: '222', sexo: 'F', direccion: 'No write' });
    assert.equal(rollback.status, 500);
    assert.equal((await pool.query("SELECT id FROM patients WHERE documento='35123460'")).rowCount, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM reception_patient_enrollments e JOIN patients p ON p.id=e.patient_id WHERE p.documento='35123460'")).rows[0].count, 0);
    const registered = await request(userA, '/register', 'POST', { career: 'kinesiology', documento: '35123457', nombres: 'Bea', apellidos: 'Lopez', fecha_nacimiento: '1991-02-03', email: 'bea@example.com', celular: '222', sexo: 'F', direccion: 'Address' });
    assert.equal(registered.status, 201);
    const created = await registered.json();
    createdPatientId = created.id;
    assert.deepEqual(Object.keys(created).sort(), ['id','documento','nombres','apellidos','fecha_nacimiento','email','celular','sexo','direccion'].sort());
    const repeated = await request(userA, '/register', 'POST', { career: 'kinesiology', documento: '35123457', nombres: 'Overwritten', apellidos: 'Other', fecha_nacimiento: '1991-02-03', email: 'other@example.com', celular: '333', sexo: 'F', direccion: 'Other' });
    assert.equal(repeated.status, 409);
    const creationAudit = await pool.query('SELECT created_by,updated_by,updated_at FROM patients WHERE id=$1', [created.id]);
    assert.deepEqual(creationAudit.rows[0], { created_by: userA, updated_by: null, updated_at: null });
    const enrollmentCount = await pool.query('SELECT count(*)::int AS count FROM reception_patient_enrollments WHERE patient_id=$1', [created.id]);
    assert.equal(enrollmentCount.rows[0].count, 1);

    const racingBody = { career: 'kinesiology', documento: '35123458', nombres: 'Race', apellidos: 'Fixture', fecha_nacimiento: '1992-04-05', email: 'race@example.com', celular: '444', sexo: 'F', direccion: 'Race address' };
    const raceOperations = [
      observeStarted(request(userA, '/register', 'POST', racingBody)),
      observeStarted(request(userB, '/register', 'POST', racingBody)),
    ];
    pendingOperations.push(...raceOperations);
    const raceOutcomes = await waitBounded(Promise.all(raceOperations), 9000, 'duplicate-document register requests did not settle');
    assert.deepEqual(raceOutcomes.map(outcome => outcome.status), ['fulfilled', 'fulfilled']);
    const raced = raceOutcomes.map(outcome => outcome.value);
    assert.deepEqual(raced.map(response => response.status).sort(), [201, 409]);
    const raceBody = await raced.find(response => response.status === 201).json();
    createdPatientId = [createdPatientId, raceBody.id].filter(Boolean);
    const raceRows = await pool.query(`SELECT p.id,e.career_id,p.updated_by,p.updated_at FROM patients p
      LEFT JOIN reception_patient_enrollments e ON e.patient_id=p.id WHERE p.documento='35123458'`);
    assert.equal(raceRows.rowCount, 1);
    assert.ok(raceRows.rows[0].career_id);
    assert.equal(raceRows.rows[0].updated_by, null);
    assert.equal(raceRows.rows[0].updated_at, null);

    contactPauseEnabled = true;
    const firstContact = observeStarted(request(userA, `/${patientId}?career=kinesiology`, 'PATCH', { direccion: 'Changed' }));
    pendingOperations.push(firstContact);
    await waitBounded(firstEnteredPromise, 7000, 'first contact operation did not enter the patient lock');
    const secondContact = observeStarted(request(userB, `/${patientId}?career=odontology`, 'PATCH', { celular: '999' }));
    pendingOperations.push(secondContact);
    await waitForLockWait(pool, '%FOR UPDATE OF p%');
    const outcomes = await releaseAndSettleReceptionOperations([unblockFirst], [firstContact, secondContact]);
    assert.deepEqual(outcomes.map(outcome => outcome.status), ['fulfilled', 'fulfilled']);
    const [firstResult, secondResult] = outcomes.map(outcome => outcome.value);
    assert.equal(firstResult.status, 200);
    assert.equal(secondResult.status, 200);
    const finalRow = await pool.query('SELECT email,celular,direccion,updated_by,updated_at FROM patients WHERE id=$1', [patientId]);
    assert.deepEqual({ email: finalRow.rows[0].email, celular: finalRow.rows[0].celular, direccion: finalRow.rows[0].direccion },
      { email: 'ana@example.com', celular: '999', direccion: 'Changed' });
    assert.equal(finalRow.rows[0].updated_by, userB);
    assert.ok(finalRow.rows[0].updated_at);
    const history = await request(userA, `/${patientId}?career=kinesiology`);
    const historyBody = await history.json();
    assert.equal(history.status, 200);
    assert.equal(Object.hasOwn(historyBody, 'created_by'), false);
    assert.equal(Object.hasOwn(historyBody, 'created_at'), false);
    assert.equal(Object.hasOwn(historyBody, 'updated_by'), false);
    assert.equal(Object.hasOwn(historyBody, 'updated_at'), false);
    const patientIds = [patientId, patientUnenrolledId, ...(Array.isArray(createdPatientId) ? createdPatientId : [createdPatientId])].filter(Boolean);
    const snapshot = async () => Promise.all([
      pool.query('SELECT id,documento,nombres,apellidos,email,celular,direccion,created_by,created_at,updated_by,updated_at FROM patients WHERE id=ANY($1::uuid[]) ORDER BY id', [patientIds]),
      pool.query('SELECT patient_id,career_id FROM reception_patient_enrollments WHERE patient_id=ANY($1::uuid[]) ORDER BY patient_id,career_id', [patientIds]),
      pool.query('SELECT user_id,career_id,revoked_by,revoked_at FROM reception_career_grants WHERE user_id=ANY($1::uuid[]) ORDER BY user_id,career_id', [[userA,userB]]),
    ]).then(results => results.map(result => result.rows));
    await pool.query('UPDATE reception_career_grants SET revoked_by=$2,revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL', [userA, adminId]);
    const beforeRevokedRequests = await snapshot();
    assert.equal((await requestUrl(adminId, '/reception/patients?career=kinesiology')).status, 403);
    const revokedMatch = await request(userA, '/match', 'POST', { career: 'kinesiology', documento: '35123456' });
    assert.equal(revokedMatch.status, 404);
    assert.equal((await request(userA, '/reuse', 'POST', { career: 'kinesiology', patient_id: patientId, documento: '35123456' })).status, 404);
    assert.equal((await request(userA, '/register', 'POST', { career: 'kinesiology', documento: '35123461', nombres: 'Revoked', apellidos: 'Fixture', fecha_nacimiento: '1994-01-02', email: 'revoked@example.com', celular: '111', sexo: 'F', direccion: 'No write' })).status, 404);
    assert.equal((await request(userA, '?career=kinesiology')).status, 404);
    assert.equal((await request(userA, `/${patientId}?career=kinesiology`)).status, 404);
    assert.equal((await request(userA, `/${patientId}?career=kinesiology`, 'PATCH', { celular: '000' })).status, 404);
    assert.equal((await requestUrl(userA, '/patient-assignments', 'POST', {})).status, 403);
    assert.equal((await requestUrl(userA, '/patient-availabilities', 'POST', {})).status, 403);
    assert.deepEqual(await snapshot(), beforeRevokedRequests);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupActions = [
      async () => { releaseRegistrationLookups?.(); await releaseAndSettleReceptionOperations(unblockFirst ? [unblockFirst] : [], pendingOperations); },
      async () => {
        if (patientRepositoryType) {
          patientRepositoryType.prototype.findEnrolled = originalFindEnrolled;
          patientRepositoryType.prototype.findPatientByDocumento = originalFindPatientByDocumento;
          patientRepositoryType.prototype.enrollExisting = originalEnrollExisting;
        }
      },
      async () => { if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
      async () => { await pool.query(`DELETE FROM reception_patient_enrollments WHERE patient_id=ANY($1::uuid[])
        OR patient_id IN (SELECT id FROM patients WHERE created_by=ANY($2::uuid[]))`, [[patientId, patientUnenrolledId, ...(Array.isArray(createdPatientId) ? createdPatientId : [createdPatientId])].filter(Boolean), [userA,userB]]); },
      async () => { await pool.query(`DELETE FROM patients WHERE id=ANY($1::uuid[]) OR created_by=ANY($2::uuid[])`, [[patientId, patientUnenrolledId, ...(Array.isArray(createdPatientId) ? createdPatientId : [createdPatientId])].filter(Boolean), [userA,userB]]); },
      async () => { await pool.query('DELETE FROM reception_career_grants WHERE user_id=ANY($1::uuid[]) OR granted_by=$2', [[userA,userB], adminId]); },
      async () => { await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[adminId,userA,userB]]); },
      async () => { await pool.end(); },
    ];
    await cleanupReceptionTest(cleanupActions, primaryError);
  }
});
