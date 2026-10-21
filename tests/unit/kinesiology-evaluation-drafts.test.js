import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect', JWT_SECRET: 'synthetic-kinesiology-secret',
  CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'kinesiology-test-key', JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3',
});
const [{ createApp }, { JwtTokenService }] = await Promise.all([
  import('../../src/app.ts'),
  import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
]);

const actor = '30000000-0000-4000-8000-000000000001';
const patient = '70000000-0000-4000-8000-000000000001';
const student = '30000000-0000-4000-8000-000000000011';
const period = '60000000-0000-4000-8000-000000000001';
const subject = '10000000-0000-4000-8000-000000000001';
const group = '20000000-0000-4000-8000-000000000001';
const otherSubject = '10000000-0000-4000-8000-000000000002';
const otherGroup = '20000000-0000-4000-8000-000000000002';
const grants = ['kinesiology-evaluations:read', 'kinesiology-evaluations:write'];

function fakePool() {
  const state = { queries: [], records: [], evaluations: [], consents: [], releases: 0, commits: 0, rollbacks: 0, transactionSnapshot: null,
    failAt: null, patients: [{ id: patient, documento: '12345678', nombres: 'Ana', apellidos: 'Lopez', fecha_nacimiento: '1990-05-10', email: 'ana@example.com', celular: '+5491100000000', sexo: 'F', direccion: 'Calle 1', created_by: actor, created_at: '2020-01-01T00:00:00Z' }],
    grants: { estudiante: [...grants], teacher: ['kinesiology-evaluations:read', 'kinesiology-evaluations:write', 'kinesiology-evaluations:verify-consent'], admin: ['kinesiology-evaluations:read', 'kinesiology-evaluations:write'] },
    profiles: new Set([actor, '30000000-0000-4000-8000-000000000002']), periods: new Set([actor, '30000000-0000-4000-8000-000000000002']), assignments: new Set([actor, '30000000-0000-4000-8000-000000000002']), teachers: new Set() };
  function projectPatient(sql, row) {
    for (const field of ['documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion']) {
      assert.match(sql, new RegExp(`p\\.${field} AS patient_${field}`));
    }
    const current = state.patients.find(item => item.id === row.patient_id);
    return current ? { ...row, patient_documento: current.documento, patient_nombres: current.nombres,
      patient_apellidos: current.apellidos, patient_fecha_nacimiento: current.fecha_nacimiento,
      patient_email: current.email, patient_celular: current.celular, patient_sexo: current.sexo,
      patient_direccion: current.direccion } : row;
  }
  async function query(sql, params = []) {
    state.queries.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
      if (sql === 'BEGIN') state.transactionSnapshot = structuredClone({ records: state.records, evaluations: state.evaluations, consents: state.consents });
      if (sql === 'COMMIT') { state.commits++; state.transactionSnapshot = null; }
      if (sql === 'ROLLBACK') {
        state.rollbacks++;
        if (state.transactionSnapshot) Object.assign(state, structuredClone(state.transactionSnapshot));
        state.transactionSnapshot = null;
      }
      return { rows: [] };
    }
    if (sql.includes('FROM role_permissions')) return { rows: (state.grants[params[0]] ?? []).map(permission => ({ permission })) };
    if (sql.includes('FROM students WHERE user_id')) return { rows: state.profiles.has(params[0]) ? [{ id: params[0] === actor ? student : `${student}-other` }] : [] };
    if (sql.includes('FROM student_academic_habilitations')) {
      const user = params[0] === student ? actor : params[0] === `${student}-other` ? '30000000-0000-4000-8000-000000000002' : undefined;
      const contextMatches = user === actor
        ? params[1] === subject && params[2] === group
        : params[1] === otherSubject && params[2] === otherGroup;
      return { rows: user && contextMatches && state.periods.has(user)
        ? [{ id: user === actor ? period : `${period}-other`, subject_id: params[1], academic_group_id: params[2], student_id: params[0] }]
        : [] };
    }
    if (sql.trimStart().startsWith('SELECT t.id') && sql.includes('teacher_academic_habilitations')) {
      assert.match(sql, /SELECT t\.id/);
      assert.match(sql, /t\.user_id = \$1/);
      assert.match(sql, /th\.subject_id = \$2/);
      assert.match(sql, /th\.academic_group_id = \$3/);
      assert.match(sql, /th\.revoked_at IS NULL/);
      if (sql.includes('FOR UPDATE')) return { rows: state.teachers.has(params[0]) ? [{ id: `teacher-profile-${params[0]}`, teacher_habilitation_id: `teacher-period-${params[0]}` }] : [] };
      assert.deepEqual(params.slice(1), [subject, group]);
      return { rows: state.teachers.has(params[0]) ? [{ id: `teacher-profile-${params[0]}` }] : [] };
    }
    if (sql.includes('FROM patients WHERE id')) return { rows: state.patients.filter(row => row.id === params[0]).map(row => ({
      id: row.id, documento: row.documento, nombres: row.nombres, apellidos: row.apellidos,
      fecha_nacimiento: row.fecha_nacimiento, email: row.email, celular: row.celular,
      sexo: row.sexo, direccion: row.direccion,
    })) };
    if (sql.includes('FROM patient_assignments')) {
      const user = params[1] === student ? actor : params[1] === `${student}-other` ? '30000000-0000-4000-8000-000000000002' : actor;
      return { rows: state.assignments.has(user) ? [{ id: '9007199254740993', patient_id: patient, student_habilitation_id: user === actor ? period : `${period}-other`, subject_id: subject, academic_group_id: group, ended_at: null }] : [] };
    }
    const canRead = (row, user) => (row.author_id === user && state.profiles.has(user) && state.periods.has(user) && state.assignments.has(user)) || state.teachers.has(user);
    if (sql.includes('FROM kinesiology_evaluations e') && sql.includes('WHERE e.id = $1')) {
      const row = state.evaluations.find(item => item.id === params[0]);
      if (sql.includes('FOR UPDATE')) return { rows: row ? [row] : [] };
      assert.equal(params[1], row?.author_id === params[1] ? actor : params[1]);
      return { rows: row && canRead(row, params[1]) ? [projectPatient(sql, row)] : [] };
    }
    if (sql.includes('FROM kinesiology_evaluations e') && sql.includes('WHERE e.patient_id = $2')) {
      const [requestActor, requestPatient, requestSubject, requestGroup] = params;
      assert.equal(requestActor, params[0]);
      return { rows: state.evaluations.filter(row => row.patient_id === requestPatient && canRead(row, requestActor) && (!requestSubject || row.origin_subject_id === requestSubject) && (!requestGroup || row.origin_group_id === requestGroup)).map(row => projectPatient(sql, row)) };
    }
    if (sql.includes('FROM kinesiology_evaluations WHERE id')) return { rows: state.evaluations.filter(row => row.id === params[0]) };
    if (sql.includes('UPDATE kinesiology_evaluations')) {
      const row = state.evaluations.find(item => item.id === params[0]);
      if (!row) return { rows: [] };
      row.content = JSON.parse(params[1]); row.updated_at = new Date('2026-01-02T00:00:00Z');
      if (state.failAt === 'after-edit-update') throw new Error('synthetic edit failure');
      return { rows: [row] };
    }
    if (sql.includes('FROM kinesiology_consent_attestations')) return { rows: state.consents.filter(row => row.evaluation_id === params[0]).slice(-1) };
    if (sql.includes('INSERT INTO kinesiology_consent_attestations')) {
      const row = { id: String(9007199254740995n + BigInt(state.consents.length)), evaluation_id: params[0], paper_signature_date: params[1], verified_by: params[2], teacher_habilitation_id: params[3], verified_at: '2026-01-03T00:00:00.000Z' };
      state.consents.push(row);
      if (state.failAt === 'after-consent-insert') throw new Error('synthetic consent failure');
      return { rows: [{ id: row.id, paper_signature_date: row.paper_signature_date, verified_by: row.verified_by, verified_at: row.verified_at }] };
    }
    if (sql.includes('FROM clinical_records')) return { rows: state.records.filter(row => row.patient_id === params[0]) };
    if (sql.includes('INSERT INTO clinical_records')) {
      const existing = state.records.find(item => item.patient_id === params[0]);
      if (existing) return { rows: [] };
      const row = { id: '9007199254740993', patient_id: params[0], created_by: params[1], created_at: '2026-01-01T00:00:00Z' };
      state.records.push(row);
      return { rows: [row] };
    }
    if (sql.includes('SELECT id::text AS id FROM clinical_records')) return { rows: state.records.filter(row => row.patient_id === params[0]).map(row => ({ id: row.id })) };
    if (sql.includes('INSERT INTO kinesiology_evaluations')) {
      if (state.failAt === 'after-history-insert') throw new Error('synthetic evaluation insert failure');
      const row = { id: String(9007199254740994n + BigInt(state.evaluations.length)), clinical_record_id: '9007199254740993', patient_id: params[1], author_id: params[2], origin_student_habilitation_id: params[3], origin_subject_id: params[4], origin_group_id: params[5], content: JSON.parse(params[6]), created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-01T00:00:00Z') };
      state.evaluations.push(row);
      return { rows: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { state, query, async connect() { return { query, release() { state.releases++; } }; } };
}

async function withServer(pool, run) {
  const server = createServer(createApp(pool));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const tokens = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: process.env.JWT_SECRET_KID, previousSecrets: [], expiresIn: '1h' });
  try { await run(`http://127.0.0.1:${server.address().port}`, tokens); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

async function bearer(tokens, sub = actor, permissions = grants, role = 'estudiante') {
  return tokens.sign({ role, ...(sub === null ? {} : { sub }), username: role, permissions });
}
async function call(base, token, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('a different student with a current assignment cannot read another student\'s draft', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const otherActor = '30000000-0000-4000-8000-000000000002';
    const otherToken = await bearer(tokens, otherActor);
    const response = await call(base, otherToken, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const listing = await call(base, otherToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
    assert.equal(listing.status, 200);
    assert.deepEqual(await listing.json(), { items: [] });
  });
});

test('draft content keeps DIU distinct, preserves trivalent antecedents, and rejects invalid calendar dates', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const good = await call(base, auth, 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group,
      content: { antecedents: { diu: null, hta: false }, admission_date: null,
        studies: [{ type: 'x-ray', description: 'report', date: null }] },
    });
    assert.equal(good.status, 201);
    assert.deepEqual((await good.json()).content, { admission_date: null, antecedents: { hta: false, diu: null }, studies: [{ type: 'x-ray', description: 'report', date: null }] });
    const before = JSON.stringify(pool.state.evaluations);
    for (const content of [
      { admission_date: '2025-02-30' },
      { studies: [{ type: 'x-ray', description: 'report', date: '2025-02-30' }] },
      { antecedentes: { diu: true } },
    ]) {
      const response = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content });
      assert.equal(response.status, 400);
      assert.deepEqual(JSON.parse(JSON.stringify(pool.state.evaluations)), JSON.parse(before));
    }
  });
});

test('list requires patient scope and honors supplied subject/group filters', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    let response = await call(base, auth, 'GET', `/kinesiology-evaluations?subject_id=${subject}`);
    assert.equal(response.status, 400);
    assert.equal(pool.state.queries.some(query => query.sql.includes('FROM kinesiology_evaluations e')), false);
    response = await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`);
    assert.equal(response.status, 200);
    const query = pool.state.queries.findLast(item => item.sql.includes('FROM kinesiology_evaluations e') && item.sql.includes('WHERE e.patient_id = $2'));
    assert.match(query.sql, /e\.origin_subject_id = \$3/);
    assert.match(query.sql, /e\.origin_group_id = \$4/);
  });
});

test('foreign PATCH hides drafts without origin visibility and matches missing-target 404 without mutation', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: { illness_history: 'private prose' } });
    assert.equal(created.status, 201);
    const foreignActor = '30000000-0000-4000-8000-000000000002';
    const foreignToken = await bearer(tokens, foreignActor);
    const before = structuredClone(pool.state.evaluations);
    const beforeCommits = pool.state.commits;
    const beforeReleases = pool.state.releases;
    const denied = await call(base, foreignToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'intrusion' } });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const missing = await call(base, foreignToken, 'PATCH', '/kinesiology-evaluations/9007199254740995', { content: { illness_history: 'intrusion' } });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    assert.deepEqual(pool.state.evaluations, before);
    assert.equal(pool.state.commits, beforeCommits);
    assert.equal(pool.state.releases, beforeReleases + 2);
  });
});

test('author can edit a current-origin draft; a different student cannot', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const author = await bearer(tokens);
    const created = await call(base, author, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const before = JSON.stringify(pool.state.evaluations[0]);
    const denied = await call(base, await bearer(tokens, '30000000-0000-4000-8000-000000000002'), 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'no' } });
    assert.equal(denied.status, 404);
    assert.equal(JSON.stringify(pool.state.evaluations[0]), before);
    const updated = await call(base, author, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'reported' } });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).content.illness_history, 'reported');
    assert.equal(pool.state.commits, 2);
    assert.equal(pool.state.releases, 3);
  });
});

test('student can create a draft through the public app and IDs remain lossless strings', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const response = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(response.status, 201);
    const output = await response.json();
    assert.equal(output.id, '9007199254740994');
    assert.equal(output.clinical_record_id, '9007199254740993');
    assert.equal(output.status, 'draft');
  });
  assert.equal(pool.state.records.length, 1);
  assert.equal(pool.state.evaluations.length, 1);
  assert.equal(pool.state.commits, 1);
  assert.equal(pool.state.releases, 1);
});

test('public endpoints reject unauthenticated and malformed-subject actors before writes', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const missing = await call(base, null, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
    const malformed = await call(base, await bearer(tokens, 'not-a-uuid'), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(malformed.status, 401);
    assert.deepEqual(await malformed.json(), { error: { code: 'UNAUTHORIZED', message: 'A verified UUID actor is required' } });
    assert.equal(pool.state.records.length, 0);
    assert.equal(pool.state.evaluations.length, 0);
    assert.equal(pool.state.commits, 0);
    assert.equal(pool.state.releases, 0);
  });
});

test('body-supplied authorship and audit fields are rejected without mutation', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const response = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group, author_id: actor,
      reviewer_id: actor, created_by: actor, audit: { actor_id: actor }, content: {},
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: 'body may contain only patient_id, subject_id, academic_group_id and content' } });
    assert.equal(pool.state.records.length, 0);
    assert.equal(pool.state.evaluations.length, 0);
    assert.equal(pool.state.commits, 0);
    assert.equal(pool.state.rollbacks, 0);
    assert.equal(pool.state.releases, 0);
  });
});

test('R1 fresh role grants override unchanged token claims for reads and writes', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const created = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const saved = structuredClone(pool.state.evaluations);
    const savedRecords = structuredClone(pool.state.records);
    const commits = pool.state.commits;
    pool.state.grants.estudiante = pool.state.grants.estudiante.filter(permission => permission !== 'kinesiology-evaluations:read');
    for (const path of ['/kinesiology-evaluations/9007199254740994', `/kinesiology-evaluations?patient_id=${patient}`]) {
      const response = await call(base, auth, 'GET', path);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evaluations:read' required" } });
    }
    pool.state.grants.estudiante = grants.filter(permission => permission !== 'kinesiology-evaluations:write');
    for (const [method, path, body] of [
      ['POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} }],
      ['PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'denied' } }],
    ]) {
      const response = await call(base, auth, method, path, body);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evaluations:write' required" } });
    }
    assert.deepEqual(pool.state.evaluations, saved);
    assert.deepEqual(pool.state.records, savedRecords);
    assert.equal(pool.state.commits, commits);
  });
});

test('R2 student detail/list/edit require linked profile and current origin assignment', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const saved = structuredClone(pool.state.evaluations);
    const savedRecords = structuredClone(pool.state.records);
    const commits = pool.state.commits;
    for (const [index, change] of [
      () => pool.state.profiles.delete(actor),
      () => { pool.state.profiles.add(actor); pool.state.periods.delete(actor); },
      () => { pool.state.periods.add(actor); pool.state.assignments.delete(actor); },
    ].entries()) {
      change();
      const detail = await call(base, auth, 'GET', '/kinesiology-evaluations/9007199254740994');
      assert.equal(detail.status, 404);
      assert.deepEqual(await detail.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      const listing = await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
      assert.equal(listing.status, 200);
      assert.deepEqual(await listing.json(), { items: [] });
      const update = await call(base, auth, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'denied' } });
      assert.equal(update.status, index === 2 ? 404 : 403);
      assert.deepEqual(await update.json(), index === 2
        ? { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } }
        : { error: { code: 'FORBIDDEN', message: 'an active patient assignment is required' } });
      assert.deepEqual(pool.state.evaluations, saved);
      assert.deepEqual(pool.state.records, savedRecords);
      assert.equal(pool.state.commits, commits);
    }
  });
});

test('R3 origin teacher is read-only; other students and administrators cannot bypass draft privacy', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const saved = structuredClone(pool.state.evaluations);
    const savedRecords = structuredClone(pool.state.records);
    const commits = pool.state.commits;
    const releases = pool.state.releases;
    const rollbacks = pool.state.rollbacks;
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    const teacherToken = await bearer(tokens, teacher, grants, 'teacher');
    assert.equal((await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 200);
    assert.deepEqual((await (await call(base, teacherToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).json()).items.length, 1);
    const patch = await call(base, teacherToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'teacher edit' } });
    assert.equal(patch.status, 403);
    assert.deepEqual(await patch.json(), { error: { code: 'FORBIDDEN', message: 'an active patient assignment is required' } });
    pool.state.teachers.delete(teacher);
    assert.equal((await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.deepEqual((await (await call(base, teacherToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).json()).items, []);
    const hiddenTeacherPatch = await call(base, teacherToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'nonorigin rewrite' } });
    assert.equal(hiddenTeacherPatch.status, 404);
    assert.deepEqual(await hiddenTeacherPatch.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const admin = '30000000-0000-4000-8000-000000000004';
    const adminToken = await bearer(tokens, admin, grants, 'admin');
    assert.equal((await call(base, adminToken, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.deepEqual((await (await call(base, adminToken, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).json()).items, []);
    const hiddenAdminPatch = await call(base, adminToken, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'admin edit' } });
    assert.equal(hiddenAdminPatch.status, 404);
    assert.deepEqual(await hiddenAdminPatch.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
    const deniedCreate = await call(base, adminToken, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(deniedCreate.status, 403);
    assert.deepEqual(await deniedCreate.json(), { error: { code: 'FORBIDDEN', message: 'an active student context is required' } });
    assert.deepEqual(pool.state.evaluations, saved);
    assert.deepEqual(pool.state.records, savedRecords);
    assert.equal(pool.state.commits, commits);
    assert.equal(pool.state.rollbacks, rollbacks + 4);
    assert.equal(pool.state.releases, releases + 4);
  });
});

test('detail and list are readonly and do not create history', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const created = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const before = { records: JSON.stringify(pool.state.records), evaluations: JSON.stringify(pool.state.evaluations), commits: pool.state.commits };
    const detail = await call(base, auth, 'GET', '/kinesiology-evaluations/9007199254740994');
    assert.equal(detail.status, 200);
    assert.deepEqual(await detail.json(), await created.clone().json());
    const listing = await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}`);
    assert.equal(listing.status, 200);
    assert.equal((await listing.json()).items.length, 1);
    assert.equal(JSON.stringify(pool.state.records), before.records);
    assert.equal(JSON.stringify(pool.state.evaluations), before.evaluations);
    assert.equal(pool.state.commits, before.commits);
  });
});

test('repeated creates reuse history and PATCH preserves server-owned identity and origin', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const first = await (await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} })).json();
    const history = structuredClone(pool.state.records[0]);
    const secondResponse = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();
    assert.equal(pool.state.records.length, 1);
    assert.deepEqual(pool.state.records[0], history);
    assert.equal(second.clinical_record_id, first.clinical_record_id);
    const identity = Object.fromEntries(['author_id', 'origin_student_habilitation_id', 'origin_subject_id', 'origin_group_id'].map(key => [key, first[key]]));
    const patch = await call(base, auth, 'PATCH', `/kinesiology-evaluations/${first.id}`, { content: { illness_history: 'updated' } });
    assert.equal(patch.status, 200);
    const updated = await patch.json();
    for (const [key, value] of Object.entries(identity)) assert.equal(updated[key], value);
    assert.equal(pool.state.commits, 3);
    assert.equal(pool.state.releases, 3);
    assert.equal(pool.state.queries.some(query => query.sql.includes('ON CONFLICT (patient_id) DO NOTHING') && /RETURNING id::text AS id/.test(query.sql)), true);
    assert.equal(pool.state.queries.some(query => query.sql.startsWith('SELECT id::text AS id FROM clinical_records')), true);
  });
});

test('public draft responses project current safe patient demographics, never body identity or audit', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const created = await call(base, auth, 'POST', '/kinesiology-evaluations', {
      patient_id: patient, subject_id: subject, academic_group_id: group,
      content: { admission_date: '2020-05-10' },
    });
    assert.equal(created.status, 201);
    const output = await created.json();
    assert.deepEqual(output.patient, { id: patient, documento: '12345678', nombres: 'Ana', apellidos: 'Lopez', fecha_nacimiento: '1990-05-10', email: 'ana@example.com', celular: '+5491100000000', sexo: 'F', direccion: 'Calle 1' });
    assert.equal(output.age, 30);
    const patientQuery = pool.state.queries.find(query => query.sql.includes('FROM patients WHERE id'));
    for (const field of ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion']) assert.match(patientQuery.sql, new RegExp(`\\b${field}\\b`));
    for (const field of ['created_by', 'created_at', 'updated_by', 'updated_at']) assert.doesNotMatch(patientQuery.sql, new RegExp(`\\b${field}\\b`));
    for (const key of ['created_by', 'created_at', 'updated_by', 'updated_at', 'password', 'token']) assert.equal(Object.hasOwn(output.patient, key), false);
    const bodyIdentity = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, nombres: 'Spoof', content: {} });
    assert.equal(bodyIdentity.status, 400);
    pool.state.patients[0].nombres = 'Ana Actualizada';
    const detail = await call(base, auth, 'GET', `/kinesiology-evaluations/${output.id}`);
    assert.equal((await detail.json()).patient.nombres, 'Ana Actualizada');
    const patched = await call(base, auth, 'PATCH', `/kinesiology-evaluations/${output.id}`, { content: { admission_date: '2020-05-09' } });
    assert.equal(patched.status, 200);
    const patchedOutput = await patched.json();
    assert.deepEqual(patchedOutput.patient, { ...output.patient, nombres: 'Ana Actualizada' });
    assert.equal(patchedOutput.age, 29);
    const pendingAdmission = await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal((await pendingAdmission.json()).age, null);
  });
});

test('hidden and missing detail/list reads create no rows and perform no writes', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const auth = await bearer(tokens);
    const before = { records: structuredClone(pool.state.records), evaluations: structuredClone(pool.state.evaluations), commits: pool.state.commits, rollbacks: pool.state.rollbacks };
    assert.equal((await call(base, auth, 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.equal((await call(base, auth, 'GET', `/kinesiology-evaluations?patient_id=${patient}`)).status, 200);
    assert.equal((await call(base, await bearer(tokens, '30000000-0000-4000-8000-000000000002'), 'GET', '/kinesiology-evaluations/9007199254740994')).status, 404);
    assert.deepEqual(pool.state.records, before.records);
    assert.deepEqual(pool.state.evaluations, before.evaluations);
    assert.equal(pool.state.commits, before.commits);
    assert.equal(pool.state.rollbacks, before.rollbacks);
  });
});

test('consent is private pending evidence until origin teacher records and verifies paper date', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const authorToken = await bearer(tokens);
    await call(base, authorToken, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: { illness_history: 'unchanged prose' } });
    const teacher = '30000000-0000-4000-8000-000000000003';
    const teacherToken = await bearer(tokens, teacher, ['kinesiology-evaluations:read', 'kinesiology-evaluations:verify-consent'], 'teacher');
    const author = await call(base, authorToken, 'GET', '/kinesiology-evaluations/9007199254740994/consent');
    assert.equal(author.status, 200);
    assert.deepEqual(await author.json(), { evaluation_id: '9007199254740994', status: 'pending', evidence: null });
    pool.state.teachers.add(teacher);
    assert.deepEqual(await (await call(base, teacherToken, 'GET', '/kinesiology-evaluations/9007199254740994/consent')).json(), { evaluation_id: '9007199254740994', status: 'pending', evidence: null });
    const beforeContent = structuredClone(pool.state.evaluations[0]);
    const verified = await call(base, teacherToken, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2026-03-08' });
    assert.equal(verified.status, 201);
    assert.deepEqual(await verified.json(), { evaluation_id: '9007199254740994', status: 'verified', evidence: { id: '9007199254740995', paper_signature_date: '2026-03-08', verified_by: teacher, verified_at: '2026-01-03T00:00:00.000Z' } });
    assert.deepEqual(pool.state.evaluations[0], beforeContent);
    assert.equal(pool.state.consents[0].teacher_habilitation_id, `teacher-period-${teacher}`);
    const lockQueries = pool.state.queries.filter(({ sql }) => sql.includes('FOR UPDATE'));
    const teacherLock = lockQueries.findLastIndex(({ sql }) => sql.includes('teacher_academic_habilitations'));
    const patientLock = lockQueries.findLastIndex(({ sql }) => sql.includes('FROM patients WHERE id'));
    const evaluationLock = lockQueries.findLastIndex(({ sql }) => sql.includes('FROM kinesiology_evaluations e') && sql.includes('FOR UPDATE'));
    assert.ok(teacherLock >= 0 && teacherLock < patientLock && patientLock < evaluationLock);
    assert.equal((await call(base, authorToken, 'GET', '/kinesiology-evaluations/9007199254740994/consent')).status, 200);
  });
});

test('consent rejects invalid bodies, non-origin actors and stale grants without changing evidence', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const teacher = '30000000-0000-4000-8000-000000000003';
    const auth = await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher');
    pool.state.teachers.add(teacher);
    const before = structuredClone(pool.state.consents);
    for (const body of [{}, { paper_signature_date: null }, { paper_signature_date: '2025-02-30' }, { paper_signature_date: '2025-01-01', verified_by: actor }]) {
      const denied = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', body);
      assert.equal(denied.status, 400);
      assert.deepEqual(pool.state.consents, before);
    }
    pool.state.grants.estudiante.push('kinesiology-evaluations:verify-consent');
    const studentBypass = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(studentBypass.status, 404);
    assert.deepEqual(pool.state.consents, before);
    const admin = '30000000-0000-4000-8000-000000000004';
    const adminAuth = await bearer(tokens, admin, ['kinesiology-evaluations:verify-consent'], 'admin');
    const adminDenied = await call(base, adminAuth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(adminDenied.status, 403);
    assert.deepEqual(pool.state.consents, before);
    const invalidId = await call(base, auth, 'POST', '/kinesiology-evaluations/9223372036854775808/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(invalidId.status, 400);
    assert.deepEqual(pool.state.consents, before);
    pool.state.teachers.delete(teacher);
    const noContext = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(noContext.status, 404);
    assert.deepEqual(pool.state.consents, before);
    pool.state.grants.teacher = [];
    pool.state.teachers.add(teacher);
    const noGrant = await call(base, auth, 'POST', '/kinesiology-evaluations/9007199254740994/consent', { paper_signature_date: '2025-01-01' });
    assert.equal(noGrant.status, 403);
    assert.deepEqual(pool.state.consents, before);
  });
});

test('consent POST hides private evaluation existence from non-origin and revoked teachers', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const created = await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    assert.equal(created.status, 201);
    const teacher = '30000000-0000-4000-8000-000000000003';
    const token = await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher');
    for (const revoked of [false, true]) {
      if (revoked) {
        pool.state.teachers.add(teacher);
        assert.equal((await call(base, token, 'GET', '/kinesiology-evaluations/9007199254740994/consent')).status, 200);
        pool.state.teachers.delete(teacher);
      }
      const before = structuredClone({ records: pool.state.records, evaluations: pool.state.evaluations, consents: pool.state.consents, commits: pool.state.commits });
      const rollbacks = pool.state.rollbacks, releases = pool.state.releases;
      for (const id of ['9007199254740994', '9007199254740999']) {
        const denied = await call(base, token, 'POST', `/kinesiology-evaluations/${id}/consent`, { paper_signature_date: '2025-01-01' });
        assert.equal(denied.status, 404);
        assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evaluation was not found' } });
      }
      assert.deepEqual({ records: pool.state.records, evaluations: pool.state.evaluations, consents: pool.state.consents, commits: pool.state.commits }, before);
      assert.equal(pool.state.rollbacks, rollbacks + 2);
      assert.equal(pool.state.releases, releases + 2);
    }
  });
});

test('teacher consent evidence appends on repeats and failed insert rolls back and releases', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const teacher = '30000000-0000-4000-8000-000000000003';
    pool.state.teachers.add(teacher);
    const token = await bearer(tokens, teacher, ['kinesiology-evaluations:verify-consent'], 'teacher');
    await call(base, await bearer(tokens), 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} });
    const path = '/kinesiology-evaluations/9007199254740994/consent';
    const first = await call(base, token, 'POST', path, { paper_signature_date: '2025-01-01' });
    assert.equal(first.status, 201);
    const firstEvidence = (await first.json()).evidence;
    const second = await call(base, token, 'POST', path, { paper_signature_date: '2025-02-01' });
    assert.equal(second.status, 201);
    assert.equal((await second.json()).evidence.id, '9007199254740996');
    assert.equal(pool.state.consents.length, 2);
    assert.equal(pool.state.consents[0].paper_signature_date, firstEvidence.paper_signature_date);
    const before = structuredClone(pool.state.consents);
    const commits = pool.state.commits, releases = pool.state.releases, rollbacks = pool.state.rollbacks;
    pool.state.failAt = 'after-consent-insert';
    const failure = await call(base, token, 'POST', path, { paper_signature_date: '2025-03-01' });
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
    assert.deepEqual(pool.state.consents, before);
    assert.equal(pool.state.commits, commits);
    assert.equal(pool.state.rollbacks, rollbacks + 1);
    assert.equal(pool.state.releases, releases + 1);
  });
});

test('fake SQL failures after writes roll back business state and always release without commit', async () => {
  for (const failAt of ['after-history-insert', 'after-edit-update']) {
    const pool = fakePool();
    await withServer(pool, async (base, tokens) => {
      const auth = await bearer(tokens);
      if (failAt === 'after-edit-update') {
        await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: { illness_history: 'original' } });
      }
      const before = { records: structuredClone(pool.state.records), evaluations: structuredClone(pool.state.evaluations), commits: pool.state.commits, releases: pool.state.releases, rollbacks: pool.state.rollbacks };
      pool.state.failAt = failAt;
      const response = failAt === 'after-history-insert'
        ? await call(base, auth, 'POST', '/kinesiology-evaluations', { patient_id: patient, subject_id: subject, academic_group_id: group, content: {} })
        : await call(base, auth, 'PATCH', '/kinesiology-evaluations/9007199254740994', { content: { illness_history: 'changed' } });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
      assert.deepEqual(pool.state.records, before.records);
      assert.deepEqual(pool.state.evaluations, before.evaluations);
      assert.equal(pool.state.commits, before.commits);
      assert.equal(pool.state.rollbacks, before.rollbacks + 1);
      assert.equal(pool.state.releases, before.releases + 1);
    });
  }
});
