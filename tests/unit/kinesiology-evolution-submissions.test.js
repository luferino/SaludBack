import test from 'node:test';
import assert from 'node:assert/strict';
import { evolutionActor, evolutionPatient, evolutionSubject, evolutionGroup, evolutionGrants, withEvolutionServer } from '../helpers/evolution-http.js';
import { evolutionSyntheticPool } from '../helpers/evolution-synthetic-pool.js';

const tokenFor = (tokens, role = 'estudiante', sub = evolutionActor, permissions = [...evolutionGrants, 'kinesiology-evolutions:submit']) =>
  tokens.sign({ role, sub, username: role, permissions });
const headers = token => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const complete = { session_date: '2026-02-28', current_status: 'Stable', objectives: 'Improve mobility', planned_treatment: 'Guided exercise' };
const draftRequest = { patient_id: evolutionPatient, evaluation_id: '9007199254740993', subject_id: evolutionSubject,
  academic_group_id: evolutionGroup, content: complete };
async function createDraft(base, tokens, body = draftRequest) {
  const response = await fetch(`${base}/kinesiology-evolutions`, { method: 'POST', headers: headers(tokens), body: JSON.stringify(body) });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}
async function submit(base, token, id, body = {}) {
  return fetch(`${base}/kinesiology-evolutions/${id}/submissions`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
}

test('complete current author submits a snapshot through the public route', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const auth = await tokenFor(tokens);
    const created = await fetch(`${base}/kinesiology-evolutions`, { method: 'POST', headers: headers(auth), body: JSON.stringify(draftRequest) });
    assert.equal(created.status, 201, await created.clone().text());
    const draft = await created.json();
    const response = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { method: 'POST', headers: headers(auth), body: '{}' });
    assert.equal(response.status, 201, await response.clone().text());
    const submitted = await response.json();
    assert.deepEqual(submitted.content, { session_date: '2026-02-28', current_status: 'Stable', objectives: 'Improve mobility', planned_treatment: 'Guided exercise' });
    assert.equal(submitted.validation_status, 'pending_validation');
    assert.equal(submitted.ordinal, '1');
    assert.equal(submitted.submitted_by, evolutionActor);
  });
  assert.equal(pool.state.submissions?.length, 1);
  assert.equal(pool.state.evolutions[0].status, 'submitted');
  assert.equal(pool.state.commits, 2);
  assert.equal(pool.state.releases, 2);
  assert.equal(pool.state.submissions[0].content.current_status, 'Stable');
});

test('submission completeness, strict body, fresh permission and verified actor reject without snapshot writes', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const completeToken = await tokenFor(tokens);
    const invalid = [
      [{ ...complete, session_date: undefined }, 'all evolution fields are required for submission'],
      [{ ...complete, session_date: null }, 'all evolution fields are required for submission'],
      [{ ...complete, current_status: '  ' }, 'all evolution fields are required for submission'],
      [{ ...complete, objectives: null }, 'all evolution fields are required for submission'],
      [{ ...complete, planned_treatment: 3 }, 'planned_treatment must be a string or null'],
      [{ ...complete, session_date: '2026-02-30' }, 'session_date must be a valid YYYY-MM-DD date'],
    ];
    for (const [index, [content, message]] of invalid.entries()) {
      const draft = await createDraft(base, completeToken, { ...draftRequest, content: {} });
      pool.state.evolutions.at(-1).content = content;
      const before = structuredClone({ evolution: pool.state.evolutions.at(-1), submissions: pool.state.submissions });
      const queryStart = pool.state.queries.length;
      const response = await submit(base, completeToken, draft.id);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
      assert.deepEqual({ evolution: pool.state.evolutions.at(-1), submissions: pool.state.submissions }, before);
      assert.equal(pool.state.queries.slice(queryStart).some(query => query.sql.includes('INSERT INTO kinesiology_evolution_submissions')), false);
      assert.equal(pool.state.rollbacks, index + 1);
      assert.equal(pool.state.commits, index + 1);
      assert.equal(pool.state.releases, (index + 1) * 2);
    }
    const completeDraft = await createDraft(base, completeToken);
    const before = structuredClone(pool.state.submissions);
    const extra = await submit(base, completeToken, completeDraft.id, { submitted_by: evolutionActor });
    assert.equal(extra.status, 400);
    assert.deepEqual(await extra.json(), { error: { code: 'BAD_REQUEST', message: 'body must be an empty object' } });
    pool.state.grantsByRole.estudiante = ['kinesiology-evolutions:read'];
    const denied = await submit(base, await tokenFor(tokens, 'estudiante', evolutionActor, ['kinesiology-evolutions:read']), completeDraft.id);
    assert.equal(denied.status, 403);
    pool.state.grantsByRole.estudiante = evolutionGrants;
    const forged = await submit(base, tokens.sign({ role: 'estudiante', username: 'estudiante', permissions: [...evolutionGrants, 'kinesiology-evolutions:submit'] }), completeDraft.id);
    assert.equal(forged.status, 401);
    assert.deepEqual(pool.state.submissions, before);
  });
  assert.equal(pool.state.submissions.length, 0);
});

test('submitted snapshots cannot be edited or resubmitted and failed transition rolls back snapshot plus document', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const auth = await tokenFor(tokens);
    const draft = await createDraft(base, auth);
    pool.state.failUpdate = true;
    const before = structuredClone(pool.state.evolutions[0]);
    const rejected = await submit(base, auth, draft.id);
    assert.equal(rejected.status, 409);
    assert.deepEqual(await rejected.json(), { error: { code: 'CONFLICT', message: 'evolution is not an editable draft' } });
    assert.deepEqual(pool.state.evolutions[0], before);
    assert.deepEqual(pool.state.submissions, []);
    assert.equal(pool.state.rollbacks, 1);
    pool.state.failUpdate = false;
    const accepted = await submit(base, auth, draft.id);
    assert.equal(accepted.status, 201);
    const snapshot = await accepted.json();
    const original = structuredClone(pool.state.submissions[0]);
    const edit = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { method: 'PATCH', headers: headers(auth), body: JSON.stringify({ content: {} }) });
    assert.equal(edit.status, 409);
    const repeat = await submit(base, auth, draft.id);
    assert.equal(repeat.status, 409);
    assert.deepEqual(pool.state.submissions[0], original);
    assert.equal(snapshot.ordinal, '1');
  });
  assert.equal(pool.state.commits, 2);
  assert.equal(pool.state.rollbacks, 3);
});

test('submission rechecks current profile, matching assignment and locked document identity before inserting', async () => {
  const rejected = [
    state => state.profiles.delete(evolutionActor),
    state => { state.periods[0].revoked = true; },
    state => { state.assignments[0].ended = true; },
    state => { state.mutateBeforeLock = { patient_id: '70000000-0000-4000-8000-000000000099' }; },
    state => { state.mutateBeforeLock = { author_id: '30000000-0000-4000-8000-000000000099' }; },
    state => { state.mutateBeforeLock = { origin_student_habilitation_id: '60000000-0000-4000-8000-000000000099' }; },
  ];
  for (const mutate of rejected) {
    const pool = evolutionSyntheticPool();
    await withEvolutionServer(pool, async (base, tokens) => {
      const auth = await tokenFor(tokens);
      const draft = await createDraft(base, auth);
      mutate(pool.state);
      const before = structuredClone({ evolution: pool.state.evolutions[0], submissions: pool.state.submissions });
      const response = await submit(base, auth, draft.id);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
      assert.deepEqual({ evolution: pool.state.evolutions[0], submissions: pool.state.submissions }, before);
    });
    assert.equal(pool.state.submissions.length, 0);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.releases, 2);
  }
});

test('origin history remains private while current-care detail, list and history expose only the latest immutable snapshot', async () => {
  const pool = evolutionSyntheticPool();
  const careActor = '30000000-0000-4000-8000-000000000006';
  const careProfile = '31000000-0000-4000-8000-000000000006';
  const carePeriod = '60000000-0000-4000-8000-000000000006';
  const careSubject = '10000000-0000-4000-8000-000000000006';
  const careGroup = '20000000-0000-4000-8000-000000000006';
  pool.state.profiles.set(careActor, careProfile);
  pool.state.periods.push({ id: carePeriod, studentId: careProfile, subject: careSubject, group: careGroup, revoked: false });
  pool.state.assignments.push({ id: '9007199254741000', patient: evolutionPatient, subject: careSubject, period: carePeriod, ended: false });
  const teacher = '30000000-0000-4000-8000-000000000002';
  pool.state.teacherPeriods[0].revoked = true;
  pool.state.teacherPeriods.push({ id: '62000000-0000-4000-8000-000000000006', teacherId: '32000000-0000-4000-8000-000000000002', subject: careSubject, group: careGroup, revoked: false });
  await withEvolutionServer(pool, async (base, tokens) => {
    const authorToken = await tokenFor(tokens);
    const draft = await createDraft(base, authorToken);
    const historyBefore = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(authorToken) });
    assert.deepEqual(await historyBefore.json(), { evolution_id: draft.id, items: [] });
    const snapshotResponse = await submit(base, authorToken, draft.id);
    assert.equal(snapshotResponse.status, 201);
    const snapshot = await snapshotResponse.json();
    const careToken = await tokenFor(tokens, 'estudiante', careActor);
    const outsiderToken = await tokenFor(tokens, 'estudiante', '30000000-0000-0000-0000-000000000099');
    for (const token of [careToken, await tokenFor(tokens, 'teacher', teacher, ['kinesiology-evolutions:read'])]) {
      const detail = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { headers: headers(token) });
      assert.equal(detail.status, 200, await detail.clone().text());
      const view = await detail.json();
      assert.deepEqual(view.content, complete);
      assert.equal(view.submission_id, snapshot.id);
      assert.equal(view.created_at, snapshot.submitted_at);
      assert.equal(view.updated_at, snapshot.submitted_at);
      const list = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(token) });
      assert.deepEqual((await list.json()).items.map(item => item.id), [draft.id]);
      const history = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(token) });
      assert.equal(history.status, 200);
      assert.deepEqual((await history.json()).items, [snapshot]);
    }
    const hiddenDraft = await createDraft(base, authorToken, { ...draftRequest, content: {} });
    const hidden = await fetch(`${base}/kinesiology-evolutions/${hiddenDraft.id}`, { headers: headers(careToken) });
    assert.equal(hidden.status, 404);
    const outsider = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { headers: headers(outsiderToken) });
    assert.equal(outsider.status, 404);
    assert.equal(pool.state.submissions.length, 1);
  });
});

test('submission input, non-author and stale permission denials leave public history and transaction counts unchanged', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const auth = await tokenFor(tokens);
    const draft = await createDraft(base, auth);
    const history = async () => {
      const response = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(auth) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const before = await history();
    for (const body of [null, [], { content: complete }, { ordinal: '1' }]) {
      const response = await submit(base, auth, draft.id, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST',
        message: body === null ? `Unexpected token 'n', "null" is not valid JSON` : Array.isArray(body) ? 'body must be an object' : 'body must be an empty object' } });
      assert.deepEqual(await history(), before);
    }
    for (const invalidId of ['0', '01', '9223372036854775808', 'abc']) {
      const response = await submit(base, auth, invalidId);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: 'evolution id must be a positive BIGINT decimal string' } });
      assert.deepEqual(await history(), before);
    }
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 0);
    assert.equal(pool.state.releases, 1);
    pool.state.grantsByRole.teacher.push('kinesiology-evolutions:submit');
    const teacher = await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', ['kinesiology-evolutions:submit']);
    const denied = await submit(base, teacher, draft.id);
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    assert.deepEqual(await history(), before);
    const view = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { headers: headers(auth) });
    assert.deepEqual(await view.json(), draft);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.releases, 2);
  });
});

test('current-care student and teacher lose detail, list and history immediately after live context revocation', async () => {
  for (const revoke of ['assignment', 'student-period', 'teacher-period']) {
    const pool = evolutionSyntheticPool();
    const careActor = '30000000-0000-4000-8000-000000000006';
    const profile = '31000000-0000-4000-8000-000000000006';
    const period = { id: '60000000-0000-4000-8000-000000000006', studentId: profile,
      subject: '10000000-0000-4000-8000-000000000006', group: '20000000-0000-4000-8000-000000000006', revoked: false };
    const assignment = { id: '9007199254741000', patient: evolutionPatient, subject: period.subject, period: period.id, ended: false };
    pool.state.profiles.set(careActor, profile);
    pool.state.periods.push(period);
    pool.state.assignments.push(assignment);
    pool.state.teacherPeriods[0].revoked = true;
    const teacherPeriod = { id: '62000000-0000-4000-8000-000000000006',
      teacherId: '32000000-0000-4000-8000-000000000002', subject: period.subject, group: period.group, revoked: false };
    pool.state.teacherPeriods.push(teacherPeriod);
    await withEvolutionServer(pool, async (base, tokens) => {
      const author = await tokenFor(tokens);
      const draft = await createDraft(base, author);
      assert.equal((await submit(base, author, draft.id)).status, 201);
      const care = revoke === 'teacher-period'
        ? await tokenFor(tokens, 'teacher', '30000000-0000-4000-8000-000000000002', ['kinesiology-evolutions:read'])
        : await tokenFor(tokens, 'estudiante', careActor);
      assert.equal((await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { headers: headers(care) })).status, 200);
      if (revoke === 'assignment') assignment.ended = true;
      if (revoke === 'student-period') period.revoked = true;
      if (revoke === 'teacher-period') teacherPeriod.revoked = true;
      const before = structuredClone({ evolutions: pool.state.evolutions, submissions: pool.state.submissions });
      for (const suffix of ['', '/submissions']) {
        const response = await fetch(`${base}/kinesiology-evolutions/${draft.id}${suffix}`, { headers: headers(care) });
        assert.equal(response.status, 404, revoke);
        assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
      }
      const list = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(care) });
      assert.equal(list.status, 200);
      assert.deepEqual(await list.json(), { items: [] });
      assert.deepEqual({ evolutions: pool.state.evolutions, submissions: pool.state.submissions }, before);
      assert.equal(pool.state.commits, 2);
      assert.equal(pool.state.rollbacks, 0);
      assert.equal(pool.state.releases, 2);
    });
  }
});
