import test from 'node:test';
import assert from 'node:assert/strict';
import { evolutionActor, evolutionPatient, evolutionSubject, evolutionGroup, evolutionGrants, withEvolutionServer } from '../helpers/evolution-http.js';
import { evolutionSyntheticPool } from '../helpers/evolution-synthetic-pool.js';

const draft = { patient_id: evolutionPatient, evaluation_id: '9007199254740993', subject_id: evolutionSubject,
  academic_group_id: evolutionGroup, content: {} };
const tokenFor = (tokens, role = 'estudiante', sub = evolutionActor, permissions = evolutionGrants) =>
  tokens.sign({ role, sub, username: role, permissions });
const headers = token => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
async function postDraft(base, token, body = draft) {
  return fetch(`${base}/kinesiology-evolutions`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
}
function seededDraft(pool, overrides = {}) {
  const row = { id: '9007199254740995', clinical_record_id: '9007199254740994', evaluation_id: draft.evaluation_id,
    patient_id: evolutionPatient, author_id: evolutionActor, origin_student_habilitation_id: '60000000-0000-4000-8000-000000000001',
    origin_subject_id: evolutionSubject, origin_group_id: evolutionGroup, content: {}, status: 'draft',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides };
  pool.state.evolutions.push(row);
  return row;
}
function logicalSnapshot(pool) {
  return structuredClone({ evolutions: pool.state.evolutions, evaluation: pool.state.evaluation });
}
function assertRejectedTransaction(pool, before) {
  assert.deepEqual(logicalSnapshot(pool), before);
  assert.equal(pool.state.commits, 0);
  assert.equal(pool.state.rollbacks, 1);
  assert.equal(pool.state.releases, 1);
}

test('authenticated student creates a private incomplete evolution draft through createApp', async () => {
  const pool = evolutionSyntheticPool();
  const parentBefore = structuredClone(pool.state.evaluation);
  await withEvolutionServer(pool, async (base, tokens) => {
    const response = await postDraft(base, await tokenFor(tokens));
    assert.equal(response.status, 201, JSON.stringify({ body: await response.clone().json(), queries: pool.state.queries }));
    const body = await response.json();
    assert.deepEqual(body, { id: '9007199254740995', clinical_record_id: '9007199254740994', evaluation_id: draft.evaluation_id,
      patient_id: evolutionPatient, author_id: evolutionActor, origin_student_habilitation_id: '60000000-0000-4000-8000-000000000001',
      origin_subject_id: evolutionSubject, origin_group_id: evolutionGroup, content: {}, status: 'draft',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' });
    assert.notEqual(body.author_id, pool.state.evaluation.author_id);
    assert.notEqual(body.origin_student_habilitation_id, pool.state.evaluation.origin_student_habilitation_id);
    const legacy = await fetch(`${base}/kinesiology-evaluations/not-an-id`, { headers: headers(await tokenFor(tokens)) });
    assert.equal(legacy.status, 400);
    assert.deepEqual(await legacy.json(), { error: { code: 'BAD_REQUEST', message: 'evaluation id must be a positive BIGINT decimal string' } });
  });
  assert.deepEqual(pool.state.evaluation, parentBefore);
  assert.equal(pool.state.evolutions.length, 1);
  assert.equal(pool.state.commits, 1);
  assert.equal(pool.state.releases, 1);
});

test('request validation rejects invalid content, body audit keys, and non-lossless BIGINT identifiers before transaction', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const token = await tokenFor(tokens);
    const invalid = [
      [{ ...draft, content: { session_date: '2026-02-30' } }, 'session_date must be a valid YYYY-MM-DD date'],
      [{ ...draft, content: { unknown: 'reject' } }, 'content contains an unknown field'],
      [{ ...draft, author_id: evolutionActor }, 'body may contain only patient_id, evaluation_id, subject_id, academic_group_id, content'],
      [{ ...draft, evaluation_id: '9223372036854775808' }, 'evolution id must be a positive BIGINT decimal string'],
      [{ ...draft, evaluation_id: '0' }, 'evolution id must be a positive BIGINT decimal string'],
      [{ ...draft, evaluation_id: '-1' }, 'evolution id must be a positive BIGINT decimal string'],
      [{ ...draft, evaluation_id: '01' }, 'evolution id must be a positive BIGINT decimal string'],
      [{ ...draft, evaluation_id: 9007199254740993 }, 'evolution id must be a positive BIGINT decimal string'],
      [{ ...draft, content: { current_status: 4 } }, 'current_status must be a string or null'],
      [{ ...draft, content: { session_date: 4 } }, 'session_date must be a string or null'],
      [{ ...draft, patient_id: 'not-uuid' }, 'patient_id must be a UUID'],
      [{ ...draft, academic_group_id: 'not-uuid' }, 'academic_group_id must be a UUID'],
      [{ ...draft, evaluation_id: undefined }, 'evolution id must be a positive BIGINT decimal string'],
    ];
    for (const [body, message] of invalid) {
      const before = logicalSnapshot(pool);
      const queryCount = pool.state.queries.length;
      const response = await postDraft(base, token, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
      assert.deepEqual(logicalSnapshot(pool), before);
      assert.equal(pool.state.commits, 0);
      assert.equal(pool.state.rollbacks, 0);
      assert.equal(pool.state.queries.slice(queryCount).some(query => query.sql === 'BEGIN'), false);
    }
    const maxId = '9223372036854775807';
    pool.state.evaluation.id = maxId;
    const validLarge = await postDraft(base, token, { ...draft, evaluation_id: maxId, content: { session_date: '2000-02-29', objectives: null } });
    if (validLarge.status !== 201) throw new Error(JSON.stringify({ body: await validLarge.clone().json(), queries: pool.state.queries.slice(-10) }));
    assert.equal((await validLarge.json()).evaluation_id, maxId);
    const nullable = await postDraft(base, token, { ...draft, evaluation_id: maxId, content: { session_date: null, current_status: null, objectives: null, planned_treatment: null } });
    assert.equal(nullable.status, 201);
    assert.deepEqual((await nullable.json()).content, { session_date: null, current_status: null, objectives: null, planned_treatment: null });
  });
  assert.equal(pool.state.evolutions.length, 2);
  assert.equal(pool.state.evolutions[0].evaluation_id, '9223372036854775807');
  assert.deepEqual(pool.state.evolutions[1].content, { session_date: null, current_status: null, objectives: null, planned_treatment: null });
  assert.equal(pool.state.commits, 2);
  assert.equal(pool.state.rollbacks, 0);
});

test('replacement author uses the current origin period and list/detail/edit remain scoped to live membership', async () => {
  const pool = evolutionSyntheticPool();
  const replacement = '30000000-0000-4000-8000-000000000004';
  const replacementPeriod = '60000000-0000-4000-8000-000000000004';
  const replacementProfile = '31000000-0000-4000-8000-000000000014';
  pool.state.assignments.push({ id: '9007199254740998', patient: evolutionPatient, subject: evolutionSubject, period: replacementPeriod, ended: false });
  pool.state.profiles.set(replacement, replacementProfile);
  pool.state.periods.push({ id: replacementPeriod, studentId: replacementProfile, subject: evolutionSubject, group: evolutionGroup, revoked: false });
  const parentBefore = structuredClone(pool.state.evaluation);
  await withEvolutionServer(pool, async (base, tokens) => {
    const token = await tokenFor(tokens, 'estudiante', replacement);
    const response = await postDraft(base, token);
    assert.equal(response.status, 201, await response.clone().text());
    const created = await response.json();
    assert.equal(created.author_id, replacement);
    assert.equal(created.origin_student_habilitation_id, replacementPeriod);
    const detail = await fetch(`${base}/kinesiology-evolutions/${created.id}`, { headers: headers(token) });
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).content, {});
    const list = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(token) });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).items.length, 1);
    const edited = await fetch(`${base}/kinesiology-evolutions/${created.id}`, { method: 'PATCH', headers: headers(token),
      body: JSON.stringify({ content: { objectives: 'Updated' } }) });
    assert.equal(edited.status, 200);
    assert.deepEqual((await edited.json()).content, { objectives: 'Updated' });
  });
  assert.deepEqual(pool.state.evaluation, parentBefore);
  assert.equal(pool.state.evolutions[0].author_id, replacement);
  assert.equal(pool.state.evolutions[0].origin_student_habilitation_id, replacementPeriod);
});

test('origin teacher can read and list a draft but cannot edit; outsider, cross-context student and admin cannot bypass privacy', async () => {
  const pool = evolutionSyntheticPool();
  const row = seededDraft(pool);
  const outsider = '30000000-0000-0000-0000-000000000099';
  const careStudent = '30000000-0000-0000-0000-000000000006';
  const careProfile = '31000000-0000-4000-8000-000000000006';
  const carePeriod = '60000000-0000-4000-8000-000000000006';
  pool.state.profiles.set(careStudent, careProfile);
  pool.state.periods.push({ id: carePeriod, studentId: careProfile, subject: '10000000-0000-4000-8000-000000000006', group: evolutionGroup, revoked: false });
  pool.state.assignments.push({ id: '9007199254741000', patient: evolutionPatient, subject: '10000000-0000-4000-8000-000000000006', period: carePeriod, ended: false });
  const before = logicalSnapshot(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const teacherToken = await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', ['kinesiology-evolutions:read']);
    const detail = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(teacherToken) });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).id, row.id);
    const teacherList = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(teacherToken) });
    assert.deepEqual((await teacherList.json()).items.map(item => item.id), [row.id]);
    const teacherEdit = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(teacherToken), body: JSON.stringify({ content: {} }) });
    assert.equal(teacherEdit.status, 403);
    assert.deepEqual(await teacherEdit.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evolutions:write' required" } });
    const outsiderToken = await tokenFor(tokens, 'estudiante', outsider);
    for (const response of [
      await fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(outsiderToken) }),
      await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(outsiderToken), body: JSON.stringify({ content: {} }) }),
    ]) {
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    }
    const careToken = await tokenFor(tokens, 'estudiante', careStudent);
    const crossRead = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(careToken) });
    assert.equal(crossRead.status, 404);
    assert.deepEqual(await crossRead.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    const crossList = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(careToken) });
    assert.deepEqual(await crossList.json(), { items: [] });
    const admin = await tokenFor(tokens, 'admin', evolutionActor, evolutionGrants);
    const denied = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(admin) });
    assert.equal(denied.status, 403);
  });
  assert.deepEqual(logicalSnapshot(pool), before);
  assert.equal(pool.state.commits, 0);
});

test('origin edit first checks private readability then returns original author-only forbidden response', async () => {
  const pool = evolutionSyntheticPool();
  const row = seededDraft(pool);
  pool.state.grantsByRole.teacher = ['kinesiology-evolutions:read', 'kinesiology-evolutions:write'];
  const before = logicalSnapshot(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const teacher = await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', []);
    const response = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(teacher), body: JSON.stringify({ content: { objectives: 'No rewrite' } }) });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: 'only the evolution author can edit it' } });
    const outsider = await tokenFor(tokens, 'estudiante', '30000000-0000-0000-0000-000000000098');
    const hidden = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(outsider), body: JSON.stringify({ content: {} }) });
    assert.equal(hidden.status, 404);
    assert.deepEqual(await hidden.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
  });
  assert.deepEqual(logicalSnapshot(pool), before);
  assert.equal(pool.state.commits, 0);
});

test('visible origin teacher with a fresh delegated write grant receives author-only 403, not private 404', async () => {
  const pool = evolutionSyntheticPool();
  const row = seededDraft(pool);
  pool.state.grantsByRole.teacher = ['kinesiology-evolutions:read', 'kinesiology-evolutions:write'];
  const before = logicalSnapshot(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const teacher = await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', []);
    const detail = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(teacher) });
    assert.equal(detail.status, 200);
    const list = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(teacher) });
    assert.deepEqual((await list.json()).items.map(item => item.id), [row.id]);
    const edit = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(teacher), body: JSON.stringify({ content: {} }) });
    assert.equal(edit.status, 403);
    assert.deepEqual(await edit.json(), { error: { code: 'FORBIDDEN', message: 'only the evolution author can edit it' } });
  });
  assert.deepEqual(logicalSnapshot(pool), before);
  assert.equal(pool.state.commits, 0);
});

test('current author, exact active period, assignment and readable validated same-patient parent are required', async () => {
  const denied = [
    [state => state.periods[0].revoked = true, 403, 'an active student context is required'],
    [state => state.assignments[0].ended = true, 404, 'patient was not found'],
    [state => state.evaluation.status = 'draft', 404, 'evolution was not found'],
    [state => state.profiles.delete(evolutionActor), 403, 'an active student context is required'],
    [state => state.evaluation.patient_id = '70000000-0000-4000-8000-000000000099', 404, 'evolution was not found'],
    [state => { state.evaluation = null; }, 404, 'evolution was not found'],
  ];
  for (const [change, status, message] of denied) {
    const pool = evolutionSyntheticPool();
    change(pool.state);
    const before = logicalSnapshot(pool);
    await withEvolutionServer(pool, async (base, tokens) => {
      const response = await postDraft(base, await tokenFor(tokens));
      assert.equal(response.status, status);
      const error = await response.json();
      assert.deepEqual(error, { error: { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', message } });
    });
    assertRejectedTransaction(pool, before);
    assert.equal(pool.state.queries.some(query => query.sql.startsWith('INSERT INTO kinesiology_evolutions')), false);
  }
  const revokedGrant = evolutionSyntheticPool();
  revokedGrant.state.grantsByRole.estudiante = ['kinesiology-evolutions:read'];
  const grantBefore = logicalSnapshot(revokedGrant);
  await withEvolutionServer(revokedGrant, async (base, tokens) => {
    const response = await postDraft(base, await tokenFor(tokens));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evolutions:write' required" } });
  });
  assert.deepEqual(logicalSnapshot(revokedGrant), grantBefore);
  assert.equal(revokedGrant.state.queries.some(query => query.sql === 'BEGIN'), false);
});

test('create and edit reject wrong-context assignment, revoked membership, missing profile and ended assignment on reads and writes', async () => {
  for (const mutation of [
    pool => { pool.state.periods[0].subject = '10000000-0000-4000-8000-000000000099'; },
    pool => { pool.state.periods[0].group = '20000000-0000-4000-8000-000000000099'; },
    pool => { pool.state.periods[0].revoked = true; },
    pool => { pool.state.assignments[0].ended = true; },
    pool => { pool.state.profiles.delete(evolutionActor); },
  ]) {
    const pool = evolutionSyntheticPool();
    const row = seededDraft(pool);
    mutation(pool);
    const before = logicalSnapshot(pool);
    await withEvolutionServer(pool, async (base, tokens) => {
      const token = await tokenFor(tokens);
      const requests = [
        () => fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(token) }),
        () => fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(token) }),
        () => fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(token), body: JSON.stringify({ content: {} }) }),
      ];
      for (const request of requests) {
        const requestBefore = logicalSnapshot(pool);
        const response = await request();
        if (!response.url.includes('?')) {
          assert.equal(response.status, 404);
          assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
        } else {
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { items: [] });
        }
        assert.deepEqual(logicalSnapshot(pool), requestBefore);
      }
      const createBefore = logicalSnapshot(pool);
      const create = await postDraft(base, token);
      assert.deepEqual(logicalSnapshot(pool), createBefore);
      const expectedCreateStatus = pool.state.periods.some(period => period.studentId === pool.state.profiles.get(evolutionActor) &&
        period.subject === evolutionSubject && period.group === evolutionGroup && !period.revoked) ? 404 : 403;
      assert.equal(create.status, expectedCreateStatus);
      const createError = await create.json();
      assert.equal(createError.error.code, expectedCreateStatus === 403 ? 'FORBIDDEN' : 'NOT_FOUND');
    });
    assert.deepEqual(logicalSnapshot(pool), before);
    assert.equal(pool.state.commits, 0);
  }
});

test('teacher wrong subject, wrong group, and revoked context cannot read or list private drafts', async () => {
  for (const context of [
    { subject: '10000000-0000-4000-8000-000000000099', group: evolutionGroup, revoked: false },
    { subject: evolutionSubject, group: '20000000-0000-4000-8000-000000000099', revoked: false },
    { subject: evolutionSubject, group: evolutionGroup, revoked: true },
  ]) {
    const pool = evolutionSyntheticPool();
    const row = seededDraft(pool);
    pool.state.teacherPeriods[0] = { ...pool.state.teacherPeriods[0], ...context };
    const before = logicalSnapshot(pool);
    await withEvolutionServer(pool, async (base, tokens) => {
      const token = await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', ['kinesiology-evolutions:read']);
      const detail = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(token) });
      assert.equal(detail.status, 404);
      assert.deepEqual(await detail.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
      const list = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(token) });
      assert.equal(list.status, 200);
      assert.deepEqual(await list.json(), { items: [] });
    });
    assert.deepEqual(logicalSnapshot(pool), before);
    assert.equal(pool.state.commits, 0);
  }
});

test('list filters validate UUIDs and honor subject-only, group-only, and paired bindings', async () => {
  const pool = evolutionSyntheticPool();
  const one = seededDraft(pool);
  const otherGroup = '20000000-0000-4000-8000-000000000005';
  const otherSubject = '10000000-0000-4000-8000-000000000005';
  seededDraft(pool, { id: '9007199254740996', origin_group_id: otherGroup });
  seededDraft(pool, { id: '9007199254740997', origin_subject_id: otherSubject });
  for (const [suffix, subject, group] of [['005', evolutionSubject, otherGroup], ['006', otherSubject, evolutionGroup]]) {
    const period = `60000000-0000-4000-8000-0000000000${suffix}`;
    pool.state.periods.push({ id: period, studentId: pool.state.profiles.get(evolutionActor), subject, group, revoked: false });
    pool.state.assignments.push({ id: `90071992547410${suffix}`, patient: evolutionPatient, subject, period, ended: false });
  }
  await withEvolutionServer(pool, async (base, tokens) => {
    const auth = await tokenFor(tokens);
    const baseUrl = `${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`;
    for (const [query, expected] of [
      ['', [one.id, '9007199254740996', '9007199254740997']],
      [`&subject_id=${evolutionSubject}`, [one.id, '9007199254740996']],
      [`&academic_group_id=${evolutionGroup}`, [one.id, '9007199254740997']],
      [`&subject_id=${evolutionSubject}&academic_group_id=${evolutionGroup}`, [one.id]],
      [`&subject_id=${otherSubject}&academic_group_id=${otherGroup}`, []],
    ]) {
      const response = await fetch(`${baseUrl}${query}`, { headers: headers(auth) });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).items.map(item => item.id), expected);
    }
    for (const query of ['?patient_id=bad', `?patient_id=${evolutionPatient}&subject_id=bad`, `?patient_id=${evolutionPatient}&academic_group_id=bad`]) {
      const response = await fetch(`${base}/kinesiology-evolutions${query}`, { headers: headers(auth) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
  });
  assert.deepEqual(pool.state.evolutions.map(item => item.id), [one.id, '9007199254740996', '9007199254740997']);
});

test('input validation rejects missing UUIDs, strict keys, malformed PATCH content, and date boundaries', async () => {
  const pool = evolutionSyntheticPool();
  const row = seededDraft(pool);
  const before = logicalSnapshot(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const token = await tokenFor(tokens);
    const invalidCreates = [
      [{ ...draft, patient_id: undefined }, 'patient_id must be a UUID'],
      [{ ...draft, subject_id: 'not-uuid' }, 'subject_id must be a UUID'],
      [{ ...draft, academic_group_id: undefined }, 'academic_group_id must be a UUID'],
      [{ ...draft, extra: 'reject' }, 'body may contain only patient_id, evaluation_id, subject_id, academic_group_id, content'],
      [{ ...draft, content: [] }, 'content must be an object'],
      [{ ...draft, content: { session_date: '2026-02-29' } }, 'session_date must be a valid YYYY-MM-DD date'],
    ];
    for (const [body, message] of invalidCreates) {
      const stateBefore = logicalSnapshot(pool);
      const beginCount = pool.state.queries.filter(query => query.sql === 'BEGIN').length;
      const response = await postDraft(base, token, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
      assert.deepEqual(logicalSnapshot(pool), stateBefore);
      assert.equal(pool.state.queries.filter(query => query.sql === 'BEGIN').length, beginCount);
    }
    const validBoundary = await postDraft(base, token, { ...draft, content: { session_date: '2024-02-29' } });
    assert.equal(validBoundary.status, 201);
    const audit = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(token),
      body: JSON.stringify({ content: {}, updated_at: 'spoof' }) });
    assert.equal(audit.status, 400);
    assert.deepEqual(await audit.json(), { error: { code: 'BAD_REQUEST', message: 'body may contain only content' } });
    const badContent = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(token),
      body: JSON.stringify({ content: { planned_treatment: false } }) });
    assert.equal(badContent.status, 400);
    assert.deepEqual(await badContent.json(), { error: { code: 'BAD_REQUEST', message: 'planned_treatment must be a string or null' } });
  });
  assert.deepEqual(pool.state.evaluation, before.evaluation);
  assert.equal(pool.state.evolutions[0].id, row.id);
});

test('teacher write request rejects body fields and non-owner while preserving readable state', async () => {
  const pool = evolutionSyntheticPool();
  const row = seededDraft(pool);
  pool.state.grantsByRole.teacher = ['kinesiology-evolutions:read', 'kinesiology-evolutions:write'];
  const before = logicalSnapshot(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const teacher = await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', []);
    const invalidBody = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(teacher), body: JSON.stringify({ content: {}, author_id: evolutionActor }) });
    assert.equal(invalidBody.status, 400);
    assert.deepEqual(await invalidBody.json(), { error: { code: 'BAD_REQUEST', message: 'body may contain only content' } });
    const nonOwner = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(teacher), body: JSON.stringify({ content: {} }) });
    assert.equal(nonOwner.status, 403);
    assert.deepEqual(await nonOwner.json(), { error: { code: 'FORBIDDEN', message: 'only the evolution author can edit it' } });
  });
  assert.deepEqual(logicalSnapshot(pool), before);
  assert.equal(pool.state.commits, 0);
});

test('verified actor with a linked student profile is authorized by live context rather than JWT role label', async () => {
  const pool = evolutionSyntheticPool();
  pool.state.grantsByRole.teacher = ['kinesiology-evolutions:read', 'kinesiology-evolutions:write'];
  const beforeParent = structuredClone(pool.state.evaluation);
  await withEvolutionServer(pool, async (base, tokens) => {
    const token = await tokenFor(tokens, 'teacher', evolutionActor, []);
    const created = await postDraft(base, token);
    assert.equal(created.status, 201);
    const row = await created.json();
    assert.equal(row.author_id, evolutionActor);
    const edit = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(token),
      body: JSON.stringify({ content: { objectives: 'Profile and assignment authorize' } }) });
    assert.equal(edit.status, 200);
    assert.deepEqual((await edit.json()).content, { objectives: 'Profile and assignment authorize' });
  });
  assert.deepEqual(pool.state.evaluation, beforeParent);
  assert.equal(pool.state.evolutions.length, 1);
  assert.equal(pool.state.evolutions[0].author_id, evolutionActor);
  assert.equal(pool.state.commits, 2);
  assert.equal(pool.state.rollbacks, 0);
});

test('create and edit denial and database failures preserve rows, parent, logical counts, and transaction counters', async () => {
  const pool = evolutionSyntheticPool();
  pool.state.failAfterInsert = true;
  const parent = structuredClone(pool.state.evaluation);
  await withEvolutionServer(pool, async (base, tokens) => {
    const response = await postDraft(base, await tokenFor(tokens));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
  });
  assert.deepEqual(pool.state.evolutions, []);
  assert.deepEqual(pool.state.evaluation, parent);
  assert.equal(pool.state.commits, 0);
  assert.equal(pool.state.rollbacks, 1);
  assert.equal(pool.state.releases, 1);

  const noUpdate = evolutionSyntheticPool();
  const row = seededDraft(noUpdate);
  noUpdate.state.failUpdate = true;
  const before = logicalSnapshot(noUpdate);
  await withEvolutionServer(noUpdate, async (base, tokens) => {
    const response = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(await tokenFor(tokens)),
      body: JSON.stringify({ content: { objectives: 'not saved' } }) });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: 'CONFLICT', message: 'evolution is not an editable draft' } });
  });
  assertRejectedTransaction(noUpdate, before);
});

test('locked edit revalidation rejects each raced identity field and stale status without mutation', async () => {
  const original = { id: '9007199254740995', clinical_record_id: '9007199254740994', evaluation_id: draft.evaluation_id,
    patient_id: evolutionPatient, author_id: evolutionActor, origin_student_habilitation_id: '60000000-0000-4000-8000-000000000001',
    origin_subject_id: evolutionSubject, origin_group_id: evolutionGroup, content: {}, status: 'draft',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
  for (const mutation of [
    { id: '9007199254740998' }, { patient_id: '70000000-0000-4000-8000-000000000099' },
    { clinical_record_id: '9007199254740998' }, { evaluation_id: '9007199254740998' },
    { author_id: '30000000-0000-4000-8000-000000000008' },
    { origin_student_habilitation_id: '60000000-0000-4000-8000-000000000009' },
    { origin_subject_id: '10000000-0000-4000-8000-000000000009' },
    { origin_group_id: '20000000-0000-4000-8000-000000000009' },
  ]) {
    const pool = evolutionSyntheticPool();
    pool.state.evolutions.push({ ...original });
    pool.state.mutateBeforeLock = mutation;
    const before = logicalSnapshot(pool);
    await withEvolutionServer(pool, async (base, tokens) => {
      const response = await fetch(`${base}/kinesiology-evolutions/${original.id}`, { method: 'PATCH', headers: headers(await tokenFor(tokens)), body: JSON.stringify({ content: {} }) });
      assert.equal(response.status, 404, JSON.stringify(mutation));
      assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    });
    assertRejectedTransaction(pool, before);
  }
  const stale = evolutionSyntheticPool();
  seededDraft(stale, { status: 'submitted' });
  const beforeStale = logicalSnapshot(stale);
  await withEvolutionServer(stale, async (base, tokens) => {
    const response = await fetch(`${base}/kinesiology-evolutions/9007199254740995`, { method: 'PATCH', headers: headers(await tokenFor(tokens)), body: JSON.stringify({ content: {} }) });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: 'CONFLICT', message: 'evolution is not an editable draft' } });
  });
  assertRejectedTransaction(stale, beforeStale);
});

test('renewed period among multiple active periods preserves identity and allows author edit in exact origin context', async () => {
  const pool = evolutionSyntheticPool();
  const historical = '60000000-0000-4000-8000-000000000009';
  const current = '60000000-0000-4000-8000-000000000010';
  pool.state.periods.push({ id: current, studentId: pool.state.profiles.get(evolutionActor), subject: evolutionSubject, group: evolutionGroup, revoked: false });
  pool.state.assignments.push({ id: '9007199254741001', patient: evolutionPatient, subject: evolutionSubject, period: current, ended: false });
  const row = seededDraft(pool, { origin_student_habilitation_id: historical });
  const before = structuredClone(pool.state.evaluation);
  await withEvolutionServer(pool, async (base, tokens) => {
    const response = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(await tokenFor(tokens)), body: JSON.stringify({ content: { current_status: 'Renewed period' } }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).origin_student_habilitation_id, historical);
  });
  assert.deepEqual(pool.state.evaluation, before);
  assert.equal(pool.state.evolutions[0].origin_student_habilitation_id, historical);
  assert.deepEqual(pool.state.evolutions[0].content, { current_status: 'Renewed period' });
});

test('missing patient filter and invalid optional list filters reject without clinical writes', async () => {
  const pool = evolutionSyntheticPool();
  const before = logicalSnapshot(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const token = await tokenFor(tokens);
    for (const [url, message] of [
      [`${base}/kinesiology-evolutions`, 'patient_id must be a UUID'],
      [`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}&subject_id=bad`, 'subject_id must be a UUID'],
      [`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}&academic_group_id=bad`, 'academic_group_id must be a UUID'],
      [`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}&patient_id=${evolutionPatient}`, 'patient_id must be a UUID']
    ]) {
      const count = pool.state.queries.length;
      const response = await fetch(url, { headers: headers(token) });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
      assert.deepEqual(logicalSnapshot(pool), before);
      assert.equal(pool.state.queries.slice(count).some(query => query.sql.includes('FROM kinesiology_evolutions')), false);
    }
  });
  assert.deepEqual(logicalSnapshot(pool), before);
});

test('author edit after assignment revocation rolls back once and keeps the draft unchanged', async () => {
  const pool = evolutionSyntheticPool();
  const row = seededDraft(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const token = await tokenFor(tokens);
    const path = `${base}/kinesiology-evolutions/${row.id}`;
    const updated = await fetch(path, { method: 'PATCH', headers: headers(token), body: JSON.stringify({ content: { objectives: 'Updated' } }) });
    assert.equal(updated.status, 200, await updated.clone().text());
    assert.deepEqual((await updated.json()).content, { objectives: 'Updated' });
    const before = structuredClone(pool.state.evolutions);
    pool.state.mutateBeforeLock = { patient_id: '70000000-0000-4000-8000-000000000099' };
    const raced = await fetch(path, { method: 'PATCH', headers: headers(token), body: JSON.stringify({ content: {} }) });
    assert.equal(raced.status, 404);
    assert.deepEqual(await raced.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    assert.deepEqual(pool.state.evolutions, before);
    pool.state.assignments = [];
    const revoked = await fetch(path, { method: 'PATCH', headers: headers(token), body: JSON.stringify({ content: {} }) });
    assert.equal(revoked.status, 404);
    assert.deepEqual(await revoked.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    assert.deepEqual(pool.state.evolutions, before);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 2);
  });
});

test('author cannot edit a validated evolution and its validated document stays unchanged', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens);
    const created = await postDraft(base, author, { ...draft, content: { session_date: '2026-02-28', current_status: 'Stable', objectives: 'Improve mobility', planned_treatment: 'Guided exercise' } });
    assert.equal(created.status, 201, await created.clone().text());
    const row = await created.json();
    const submitted = await fetch(`${base}/kinesiology-evolutions/${row.id}/submissions`, { method: 'POST', headers: headers(author), body: '{}' });
    assert.equal(submitted.status, 201, await submitted.clone().text());
    const snapshot = await submitted.json();
    const teacher = await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', ['kinesiology-evolutions:read', 'kinesiology-evolutions:review']);
    const validated = await fetch(`${base}/kinesiology-evolutions/${row.id}/validations`, { method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id }) });
    assert.equal(validated.status, 201, await validated.clone().text());
    const before = logicalSnapshot(pool);
    const edit = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(author), body: JSON.stringify({ content: { objectives: 'After validation' } }) });
    assert.equal(edit.status, 409);
    assert.deepEqual(await edit.json(), { error: { code: 'CONFLICT', message: 'evolution is not an editable draft' } });
    assert.deepEqual(logicalSnapshot(pool), before);
  });
  assert.equal(pool.state.evolutions[0].status, 'validated');
  assert.equal(pool.state.reviews.length, 1);
  assert.equal(pool.state.rollbacks, 1);
});
