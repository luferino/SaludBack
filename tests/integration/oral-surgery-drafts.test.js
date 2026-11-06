import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';

const selected = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
let pool, server, base, config, JwtTokenService, cleanDb;
let cleanupAuthorized = false;
const name = prefix => `${prefix}${randomUUID().replaceAll('-', '')}`;
const hidden = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'oral surgery draft was not found' } } };
async function request(method, path, token, body) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(9000) });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  if (!selected) return;
  await verifyDisposableIntegrationTarget();
  assert.equal(process.env.DATABASE_URL, process.env.DISPOSABLE_INTEGRATION_DATABASE_URL);
  ({ default: config } = await import('../../src/config.ts'));
  ({ JwtTokenService } = await import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'));
  ({ cleanDb } = await import('./helpers/clean-db.js'));
  const { createApp } = await import('../../src/app.ts');
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6, connectionTimeoutMillis: 5000,
    options: '-c search_path=public,pg_temp -c statement_timeout=5000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000' });
  cleanupAuthorized = true;
  await cleanDb(pool);
  server = createApp(pool).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 30000 });

after(async () => {
  try {
    if (pool && cleanupAuthorized) { await cleanDb(pool); await verifyDisposableIntegrationTarget(); }
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (pool) await pool.end();
  }
}, { timeout: 30000 });

async function fixture() {
  const actors = (await pool.query(`INSERT INTO users(username,password_hash,role) VALUES
    ($1,'unused','admin'),($2,'unused','teacher'),($3,'unused','teacher'),
    ($4,'unused','estudiante'),($5,'unused','estudiante') RETURNING id,username,role`,
  [name('admin'), name('teacher'), name('otherteacher'), name('student'), name('otherstudent')])).rows;
  const [admin, teacher, otherTeacher, student, otherStudent] = actors;
  const careers = Object.fromEntries((await pool.query('SELECT code,id FROM careers')).rows.map(row => [row.code, row.id]));
  const context = async career => {
    const subject = (await pool.query('INSERT INTO subjects(name,career_id) VALUES ($1,$2) RETURNING id', [name('subject'), career])).rows[0].id;
    const group = (await pool.query('INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,$1,$2) RETURNING id', [name('group'), career])).rows[0].id;
    await pool.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) VALUES ($1,$2,$3)', [subject, group, career]);
    return { subject, group };
  };
  const origin = await context(careers.odontology), other = await context(careers.odontology);
  const foreign = await context(careers.kinesiology);
  const teachers = (await pool.query(`INSERT INTO teachers(user_id,nombres,apellidos) VALUES
    ($1,'Teacher','Origin'),($2,'Teacher','Other') RETURNING id`, [teacher.id, otherTeacher.id])).rows;
  const students = (await pool.query(`INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES
    ($1,'Student','Author',$2),($3,'Student','Other',$4) RETURNING id`, [student.id, name('STU'), otherStudent.id, name('STU')])).rows;
  await pool.query(`INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$6,$7,$4,clock_timestamp())`,
  [teachers[0].id, origin.subject, origin.group, admin.id, teachers[1].id, other.subject, other.group]);
  const periods = (await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()),($5,$2,$3,$4,clock_timestamp()) RETURNING id`,
  [students[0].id, origin.subject, origin.group, admin.id, students[1].id])).rows;
  const patient = (await pool.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion)
    VALUES ($1,'Fixture','Patient','2000-01-01',$2,'00000000','F','Fixture') RETURNING id`,
  [name('document'), `${name('patient')}@example.test`])).rows[0].id;
  await pool.query('INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by) VALUES ($1,$2,$3,$4)',
    [patient, periods[0].id, origin.subject, teacher.id]);
  const tokenService = new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid,
    previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn });
  const tokens = await Promise.all(actors.map(actor => tokenService.sign({ sub: actor.id, role: actor.role, username: actor.username })));
  return { admin, student, teacher, students, periods, patient, origin, other, foreign, tokens };
}

test('Oral Surgery draft policies round-trip through the real public API on the verified disposable target',
  { skip: !selected, timeout: 120000 }, async () => {
    const f = await fixture();
    const [admin, teacher, otherTeacher, author, otherStudent] = f.tokens;
    const endpoint = '/oral-surgery-drafts';
    const input = { patient_id: f.patient, subject_id: f.origin.subject, academic_group_id: f.origin.group };
    const list = token => request('GET', `${endpoint}?patient_id=${f.patient}`, token);
    const before = await list(admin);
    assert.deepEqual(before, { status: 200, body: { items: [] } });
    const disabled = await request('POST', endpoint, author, input);
    assert.equal(disabled.status, 403);
    assert.deepEqual(await list(admin), before);
    assert.equal((await request('POST', '/oral-surgery-subjects', admin, { subject_id: f.foreign.subject })).status, 404);
    assert.equal((await request('POST', '/oral-surgery-subjects', admin, { subject_id: f.origin.subject })).status, 201);
    const duplicate = await request('POST', '/oral-surgery-subjects', admin, { subject_id: f.origin.subject });
    assert.deepEqual(duplicate, { status: 409, body: { error: { code: 'CONFLICT', message: 'subject is already enabled for oral surgery' } } });
    assert.equal((await request('POST', '/oral-surgery-subjects', admin, { subject_id: f.other.subject })).status, 201);

    const content = { medical_history: { hospitalized: null, taking_medication: false }, treatment_plan: { procedure: 'Pending' } };
    const first = await request('POST', endpoint, author, { ...input, content });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const id = first.body.id;
    assert.deepEqual(first.body.content, content);
    assert.equal(first.body.author_id, f.student.id);
    assert.equal(first.body.origin_student_habilitation_id, f.periods[0].id);
    assert.equal(first.body.status, 'draft');
    const second = await request('POST', endpoint, author, input);
    assert.equal(second.status, 201); assert.notEqual(second.body.id, id);
    assert.equal(second.body.clinical_record_id, first.body.clinical_record_id);
    assert.deepEqual(second.body.content, {});
    const url = `${endpoint}/${id}`;
    for (const token of [author, teacher, admin]) assert.deepEqual(await request('GET', url, token), { status: 200, body: first.body });
    for (const token of [otherTeacher, otherStudent]) {
      assert.deepEqual(await request('GET', url, token), hidden);
      assert.deepEqual(await list(token), { status: 200, body: { items: [] } });
    }
    const snapshot = await list(admin);
    for (const token of [teacher, admin]) {
      assert.equal((await request('PATCH', url, token, { expected_version: '1', content: {} })).status, 403);
      assert.deepEqual(await list(admin), snapshot);
    }
    for (const body of [{ content: { medical_history: { hospitalized: 'No' } } }, { author_id: f.admin.id }]) {
      assert.equal((await request('POST', endpoint, author, { ...input, ...body })).status, 400);
      assert.deepEqual(await list(admin), snapshot);
    }
    const parallel = await Promise.all([false, null].map(answer => request('PATCH', url, author,
      { expected_version: '1', content: { medical_history: { hospitalized: answer } } })));
    assert.deepEqual(parallel.map(result => result.status).sort(), [200, 409]);
    const winner = parallel.find(result => result.status === 200).body;
    assert.equal(winner.version, '2');
    assert.deepEqual(await request('GET', url, author), { status: 200, body: winner });
    assert.equal((await request('GET', `${endpoint}/${second.body.id}`, author)).body.version, '1');

    // Public revocation ends the old assignment; a fresh valid period and assignment restore the author.
    const revoked = await request('POST', `/student-habilitations/${f.periods[0].id}/revoke`, teacher, {});
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.deepEqual(await request('GET', url, author), hidden);
    assert.deepEqual(await list(author), { status: 200, body: { items: [] } });
    assert.deepEqual(await request('PATCH', url, author, { expected_version: '2', content: {} }), hidden);
    assert.deepEqual(await request('GET', url, admin), { status: 200, body: winner });
    const period = (await pool.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
      VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id`, [f.students[0].id, f.origin.subject, f.origin.group, f.teacher.id])).rows[0].id;
    await pool.query('INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by) VALUES ($1,$2,$3,$4)',
      [f.patient, period, f.origin.subject, f.teacher.id]);
    const restored = await request('PATCH', url, author, { expected_version: '2', content: { medical_history: { hospitalized: null } } });
    assert.equal(restored.status, 200); assert.equal(restored.body.version, '3');
    assert.equal(restored.body.origin_student_habilitation_id, f.periods[0].id);
    assert.deepEqual(restored.body.content, { medical_history: { hospitalized: null } });
    assert.equal((await list(admin)).body.items.length, 2);
  });

test('S2/S3/S5: signed-paper declarations preserve history and require renewal after any treatment-plan change',
  { skip: !selected, timeout: 120000 }, async () => {
    const f = await fixture();
    const [admin, teacher, outsider, author, otherStudent] = f.tokens;
    await request('POST', '/oral-surgery-subjects', admin, { subject_id: f.origin.subject });
    const created = await request('POST', '/oral-surgery-drafts', author, {
      patient_id: f.patient, subject_id: f.origin.subject, academic_group_id: f.origin.group,
      content: { treatment_plan: { procedure: 'Plan A' } },
    });
    assert.equal(created.status, 201);
    const draft = '/oral-surgery-drafts/' + created.body.id, url = draft + '/consent';
    const history = token => request('GET', url, token);
    const initial = await history(admin);
    assert.deepEqual(initial, { status: 200, body: {
      draft_version: '1', plan_revision: '1', current_declaration_id: null, declarations: [],
    } });
    for (const token of [teacher, admin]) {
      const denied = await request('POST', url, token, { expected_version: '1', paper_signed: true });
      assert.equal(denied.status, 403);
      assert.deepEqual(await history(admin), initial);
    }
    for (const token of [outsider, otherStudent]) {
      assert.deepEqual(await history(token), hidden);
    }
    assert.deepEqual(await request('POST', url, otherStudent, { expected_version: '1', paper_signed: true }), hidden);
    for (const body of [{ expected_version: '1', paper_signed: false },
      { expected_version: '1', paper_signed: true, declared_by: f.admin.id }]) {
      assert.equal((await request('POST', url, author, body)).status, 400);
      assert.deepEqual(await history(admin), initial);
    }
    assert.deepEqual(await request('POST', url, author, { expected_version: '2', paper_signed: true }),
      { status: 409, body: { error: { code: 'CONFLICT', message: 'draft version changed; reload before saving' } } });
    assert.deepEqual(await history(admin), initial);
    const declared = await request('POST', url, author, { expected_version: '1', paper_signed: true });
    assert.equal(declared.status, 201);
    assert.equal(declared.body.declared_by, f.student.id);
    assert.equal(declared.body.draft_version, '1'); assert.equal(declared.body.plan_revision, '1');
    assert.deepEqual(declared.body.treatment_plan, { procedure: 'Plan A' });
    assert.ok(Number.isFinite(Date.parse(declared.body.declared_at)));
    assert.deepEqual(await request('GET', draft, author), { status: 200, body: created.body });
    const stored = await history(teacher);
    assert.equal(stored.body.current_declaration_id, declared.body.id);
    assert.deepEqual(stored.body.declarations, [declared.body]);
    const save = (version, content) => request('PATCH', draft, author, { expected_version: version, content });
    assert.equal((await save('1', { treatment_plan: { procedure: 'Plan A' }, medical_history: { hospitalized: false } })).status, 200);
    assert.equal((await history(author)).body.current_declaration_id, declared.body.id);
    assert.equal((await save('2', { treatment_plan: { procedure: 'Plan B' } })).status, 200);
    let state = await history(author);
    assert.equal(state.body.current_declaration_id, null); assert.equal(state.body.plan_revision, '2');
    assert.deepEqual(state.body.declarations, [declared.body]);
    assert.equal((await save('3', { treatment_plan: { procedure: 'Plan A' } })).status, 200);
    state = await history(author);
    assert.equal(state.body.current_declaration_id, null); assert.equal(state.body.plan_revision, '3');
    assert.deepEqual(state.body.declarations, [declared.body]);
    const renewed = await request('POST', url, author, { expected_version: '4', paper_signed: true });
    assert.equal(renewed.status, 201); assert.notEqual(renewed.body.id, declared.body.id);
    state = await history(author);
    assert.equal(state.body.current_declaration_id, renewed.body.id);
    assert.deepEqual(state.body.declarations, [declared.body, renewed.body]);
    assert.equal((await request('POST', '/student-habilitations/' + f.periods[0].id + '/revoke', teacher, {})).status, 200);
    const beforeDenied = await history(admin);
    assert.deepEqual(await history(author), hidden);
    assert.deepEqual(await request('POST', url, author, { expected_version: '4', paper_signed: true }), hidden);
    assert.deepEqual(await history(admin), beforeDenied);
  });
