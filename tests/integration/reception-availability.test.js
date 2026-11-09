import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';
import { cleanDb } from './helpers/clean-db.js';
import { cleanupReceptionTest } from '../helpers/reception-test-lifecycle.js';

const enabled = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
const id = () => randomUUID();
const suffix = () => id().replaceAll('-', '').slice(0, 16);
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
async function waitForLockWait(pool, queryPattern) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1`, [queryPattern]);
    if (rows[0].count > 0) return;
    await nextTurn();
  }
  assert.fail(`expected PostgreSQL lock wait was not observed: ${queryPattern}`);
}
function observeStarted(promise) { return promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })); }

// The first request proves a K-only grant cannot withdraw a known Odontology period.
test('Reception availability is career and enrollment scoped, preserves periods, and serializes grant revocation', { skip: !enabled, timeout: 20000 }, async () => {
  const target = await verifyDisposableIntegrationTarget();
  const [{ createApp }, { JwtTokenService }, { default: config }] = await Promise.all([
    import('../../src/app.ts'),
    import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
    import('../../src/config.ts'),
  ]);
  const pool = new pg.Pool({ connectionString: process.env.DISPOSABLE_INTEGRATION_DATABASE_URL, max: 6,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000,
    options: '-c search_path=pg_catalog,public,pg_temp -c lock_timeout=5000 -c idle_in_transaction_session_timeout=10000' });
  const adminId = id(), receptionId = id(), patientId = id(), subjectK = id(), groupK = id(), subjectO = id(), groupO = id();
  let server, primaryError;
  try {
    const identity = await pool.query(`SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,inet_server_addr()::text AS address,inet_server_port() AS port`);
    const norm = value => value?.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase() ?? '';
    assert.deepEqual({ ...identity.rows[0], address: norm(identity.rows[0].address) }, {
      name: target.identity.databaseName, oid: target.identity.databaseOid, owner: target.identity.databaseOwner,
      address: norm(target.identity.serverAddress), port: target.identity.serverPort,
    });
    const ledger = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    assert.equal(ledger.rowCount, 47); assert.equal(ledger.rows.at(-1).name, '047_seed_reception_availability_permissions.sql');
    await cleanDb(pool);
    const usernames = [`admin_${suffix()}`, `reception_${suffix()}`];
    await pool.query(`INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'synthetic','admin'),($3,$4,'synthetic','reception')`, [adminId,usernames[0],receptionId,usernames[1]]);
    await pool.query(`INSERT INTO reception_career_grants(user_id,career_id,granted_by) SELECT $1::uuid,id,$2::uuid FROM careers WHERE code='kinesiology'`, [receptionId, adminId]);
    await pool.query(`INSERT INTO subjects(id,name,career_id) SELECT $1::uuid,'K scoped subject',id FROM careers WHERE code='kinesiology' UNION ALL SELECT $2::uuid,'O private subject',id FROM careers WHERE code='odontology'`, [subjectK,subjectO]);
    await pool.query(`INSERT INTO academic_groups(id,academic_year,curriculum_semester,name,career_id) SELECT $1::uuid,2098,1,'K scoped group',id FROM careers WHERE code='kinesiology' UNION ALL SELECT $2::uuid,2098,1,'O private group',id FROM careers WHERE code='odontology'`, [groupK,groupO]);
    await pool.query(`INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) SELECT $1::uuid,$2::uuid,id FROM careers WHERE code='kinesiology' UNION ALL SELECT $3::uuid,$4::uuid,id FROM careers WHERE code='odontology'`, [subjectK,groupK,subjectO,groupO]);
    await pool.query(`INSERT INTO patients(id,documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion) VALUES($1,'35123456','Synthetic','Patient','1990-01-02','synthetic@example.test','111','F','synthetic')`, [patientId]);
    await pool.query(`INSERT INTO reception_patient_enrollments(patient_id,career_id) SELECT $1,id FROM careers WHERE code IN ('kinesiology','odontology')`, [patientId]);
    const foreignPeriod = (await pool.query(`INSERT INTO patient_context_availabilities(patient_id,subject_id,academic_group_id,enabled_by) VALUES($1,$2,$3,$4) RETURNING id`, [patientId,subjectO,groupO,adminId])).rows[0].id;
    const tokenService = new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid,
      previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn });
    const token = await tokenService.sign({ sub: receptionId, username: usernames[1], role: 'reception', permissions: [] });
    server = createApp(pool).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/reception/availability/${foreignPeriod}/withdraw`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ career: 'kinesiology' }), signal: AbortSignal.timeout(9000),
    });
    assert.equal(response.status, 404, 'foreign Odontology availability must be indistinguishable from absent activity');
    assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'patient availability was not found' } });
    const afterForeign = await pool.query(`SELECT a.withdrawn_by,a.withdrawn_at,
      (SELECT count(*)::int FROM reception_patient_enrollments WHERE patient_id=$1) AS enrollments,
      (SELECT count(*)::int FROM patient_assignments WHERE patient_id=$1) AS assignments
      FROM patient_context_availabilities a WHERE a.id=$2`, [patientId,foreignPeriod]);
    assert.deepEqual(afterForeign.rows, [{ withdrawn_by: null, withdrawn_at: null, enrollments: 2, assignments: 0 }]);
    await pool.query(`INSERT INTO reception_career_grants(user_id,career_id,granted_by) SELECT $1::uuid,id,$2::uuid FROM careers WHERE code='odontology'`, [receptionId,adminId]);

    const choicesResponse = await fetch(`${base}/reception/availability/contexts?career=kinesiology`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(choicesResponse.status, 200); assert.equal(choicesResponse.headers.get('cache-control'), 'no-store');
    const choices = await choicesResponse.json();
    assert.deepEqual(choices.items.map(item => [item.subject_id,item.academic_group_id]), [[subjectK,groupK]]);
    assert.deepEqual(Object.keys(choices.items[0]).sort(), ['career','subject_id','academic_group_id','subject_name','academic_group_name'].sort());
    const otherCareerChoices = await fetch(`${base}/reception/availability/contexts?career=odontology`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(otherCareerChoices.status, 200);
    assert.deepEqual((await otherCareerChoices.json()).items.map(item => [item.subject_id,item.academic_group_id]), [[subjectO,groupO]]);
    const perm = await pool.query("SELECT permission FROM role_permissions WHERE role='reception' ORDER BY permission");
    assert.deepEqual(perm.rows.map(row => row.permission), ['profile:read','reception:availability:manage','reception:careers:read','reception:patients:manage']);

    const beforePatient = await pool.query('SELECT documento,nombres,apellidos,email,celular,direccion FROM patients WHERE id=$1', [patientId]);
    const enableBody = { career: 'kinesiology', patient_id: patientId, subject_id: subjectK, academic_group_id: groupK };
    const enabled = await fetch(`${base}/reception/availability`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(enableBody) });
    assert.equal(enabled.status, 201); const enabledBody = await enabled.json();
    assert.deepEqual(Object.keys(enabledBody).sort(), ['id','subject_id','academic_group_id','enabled_at','withdrawn_at'].sort());
    const duplicate = await fetch(`${base}/reception/availability`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(enableBody) });
    assert.equal(duplicate.status, 409);
    for (const [subject,group] of [[subjectO,groupO],[subjectK,groupO]]) {
      const rejected = await fetch(`${base}/reception/availability`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...enableBody, subject_id: subject, academic_group_id: group }) });
      assert.equal(rejected.status, 404);
    }
    const unEnrolledId = id();
    await pool.query(`INSERT INTO patients(id,documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion) VALUES($1,'35123457','Unenrolled','Patient','1990-01-02','none@example.test','0','F','private')`, [unEnrolledId]);
    const unenrolled = await fetch(`${base}/reception/availability`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...enableBody, patient_id: unEnrolledId }) });
    assert.equal(unenrolled.status, 404);
    const kHistory = await fetch(`${base}/reception/availability/history?career=kinesiology&patient_id=${patientId}&limit=1`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(kHistory.status, 200); assert.equal(kHistory.headers.get('cache-control'), 'no-store');
    const page = await kHistory.json(); assert.equal(page.items.length, 1); assert.equal(page.limit, 1);
    assert.equal(JSON.stringify(page).includes(foreignPeriod), false); assert.equal(JSON.stringify(page).includes(patientId), false);
    assert.equal(JSON.stringify(page).includes(adminId), false);
    const oOnlyPatient = id();
    await pool.query(`INSERT INTO patients(id,documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion) VALUES($1,'35123458','Odontology','Only','1990-01-02','o@example.test','0','F','private')`, [oOnlyPatient]);
    await pool.query(`INSERT INTO reception_patient_enrollments(patient_id,career_id) SELECT $1,id FROM careers WHERE code='odontology'`, [oOnlyPatient]);
    const historyDenied = await fetch(`${base}/reception/availability/history?career=kinesiology&patient_id=${oOnlyPatient}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(historyDenied.status, 404);
    const searchDenied = await fetch(`${base}/reception/availability/search?career=kinesiology&documento=35123458`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(searchDenied.status, 200); assert.deepEqual((await searchDenied.json()).items, []);
    const searchAllowed = await fetch(`${base}/reception/availability/search?career=kinesiology&documento=35123456&limit=1`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(searchAllowed.status, 200); assert.deepEqual((await searchAllowed.json()).items, [{ patient_id: patientId, nombres: 'Synthetic', apellidos: 'Patient' }]);
    for (const path of [`/reception/availability/contexts?career=kinesiology&limit=101`,`/reception/availability/history?career=kinesiology&patient_id=${patientId}&offset=10001`,`/reception/availability/search?career=kinesiology&documento=35123456&limit=0`]) {
      assert.equal((await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })).status, 400);
    }
    const withdrawPath = `/reception/availability/${enabledBody.id}/withdraw`;
    const withdrawn = await fetch(`${base}${withdrawPath}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology' }) });
    assert.equal(withdrawn.status, 200); const withdrawnBody = await withdrawn.json(); assert.ok(withdrawnBody.withdrawn_at);
    const repeated = await fetch(`${base}${withdrawPath}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ career: 'kinesiology' }) });
    assert.equal(repeated.status, 200); assert.deepEqual(await repeated.json(), withdrawnBody);
    const reenabled = await fetch(`${base}/reception/availability`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(enableBody) });
    assert.equal(reenabled.status, 201); const reenabledBody = await reenabled.json(); assert.notEqual(reenabledBody.id, enabledBody.id);
    const careerPeriods = await pool.query(`SELECT count(*)::int AS count,count(*) FILTER (WHERE withdrawn_at IS NULL)::int AS active FROM patient_context_availabilities a
      JOIN subject_academic_groups sg ON sg.subject_id=a.subject_id AND sg.academic_group_id=a.academic_group_id
      JOIN careers c ON c.id=sg.career_id WHERE a.patient_id=$1 AND c.code='kinesiology'`, [patientId]);
    assert.deepEqual(careerPeriods.rows[0], { count: 2, active: 1 });
    const enrollmentCount = await pool.query('SELECT count(*)::int AS count FROM reception_patient_enrollments WHERE patient_id=$1', [patientId]);
    assert.equal(enrollmentCount.rows[0].count, 2);
    assert.deepEqual((await pool.query('SELECT documento,nombres,apellidos,email,celular,direccion FROM patients WHERE id=$1', [patientId])).rows, beforePatient.rows);

    const grant = (await pool.query("SELECT id FROM reception_career_grants WHERE user_id=$1 AND revoked_at IS NULL AND career_id=(SELECT id FROM careers WHERE code='kinesiology')", [receptionId])).rows[0];
    const blocker = await pool.connect(); let blockerOpen = true; let operation; let interleavingError;
    try {
      await blocker.query('BEGIN');
      await blocker.query('UPDATE reception_career_grants SET revoked_by=$2,revoked_at=clock_timestamp() WHERE id=$1', [grant.id,adminId]);
      operation = observeStarted(fetch(`${base}/reception/availability`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(enableBody), signal: AbortSignal.timeout(9000) }));
      await waitForLockWait(pool, '%SELECT g.id FROM reception_career_grants%');
      await blocker.query('COMMIT'); blockerOpen = false;
      const settled = await operation; assert.equal(settled.status, 'fulfilled'); assert.equal(settled.value.status, 404);
    } catch (error) {
      interleavingError = error;
    } finally {
      await cleanupReceptionTest([
        async () => { if (blockerOpen) await blocker.query('ROLLBACK'); },
        async () => blocker.release(),
        async () => { if (operation) { const settled = await operation; if (settled.status === 'rejected') throw settled.reason; } },
      ], interleavingError);
    }
    const staleChecks = [
      ['GET', '/reception/availability/contexts?career=kinesiology'],
      ['POST', '/reception/availability', enableBody],
      ['POST', `/reception/availability/${reenabledBody.id}/withdraw`, { career: 'kinesiology' }],
      ['GET', `/reception/availability/history?career=kinesiology&patient_id=${patientId}`],
      ['GET', '/reception/availability/search?career=kinesiology&documento=35123456'],
    ];
    for (const [method,path,body] of staleChecks) {
      const denied = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(denied.status, 404, `${method} ${path} must recheck the revoked live grant`);
    }
    const globalDenied = await fetch(`${base}/patient-availabilities/manage?patient_id=${patientId}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(globalDenied.status, 403);
    const globalEnableDenied = await fetch(`${base}/patient-availabilities`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ patient_id: patientId, subject_id: subjectK, academic_group_id: groupK }) });
    assert.equal(globalEnableDenied.status, 403);
    const assignmentDenied = await fetch(`${base}/patient-assignments`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ patient_id: patientId, subject_id: subjectK, academic_group_id: groupK, student_habilitation_id: id() }) });
    assert.equal(assignmentDenied.status, 403);
    const finalState = await pool.query(`SELECT a.id,a.withdrawn_by,a.withdrawn_at,
      (SELECT count(*)::int FROM reception_patient_enrollments WHERE patient_id=$1) AS enrollments,
      (SELECT count(*)::int FROM patient_assignments WHERE patient_id=$1) AS assignments
      FROM patient_context_availabilities a WHERE a.id IN ($2,$3,$4) ORDER BY a.id`, [patientId,foreignPeriod,enabledBody.id,reenabledBody.id]);
    assert.equal(finalState.rows.length, 3); assert.equal(finalState.rows.find(a => a.id === foreignPeriod).withdrawn_at, null);
    const firstKPeriod = finalState.rows.find(a => a.id === enabledBody.id);
    assert.equal(firstKPeriod.withdrawn_by, receptionId); assert.ok(firstKPeriod.withdrawn_at);
    assert.equal(finalState.rows.find(a => a.id === reenabledBody.id).withdrawn_at, null);
    assert.ok(finalState.rows.every(a => a.enrollments === 2 && a.assignments === 0));
  } catch (error) { primaryError = error; }
  const cleanupErrors = [];
  if (server) try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch (error) { cleanupErrors.push(error); }
  try { await cleanDb(pool); } catch (error) { cleanupErrors.push(error); }
  try { await pool.end(); } catch (error) { cleanupErrors.push(error); }
  if (primaryError && cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors], 'Reception availability RED and cleanup failed');
  if (primaryError) throw primaryError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Reception availability cleanup failed');
});
