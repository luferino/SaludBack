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

test('origin teacher can correct the latest submitted snapshot and current-care readers stay on that snapshot', async () => {
  const pool = evolutionSyntheticPool();
  const careActor = '30000000-0000-4000-8000-000000000006';
  const careProfile = '31000000-0000-4000-8000-000000000006';
  const carePeriod = '60000000-0000-4000-8000-000000000006';
  const careSubject = '10000000-0000-4000-8000-000000000006';
  const careGroup = '20000000-0000-4000-8000-000000000006';
  pool.state.profiles.set(careActor, careProfile);
  pool.state.periods.push({ id: carePeriod, studentId: careProfile, subject: careSubject, group: careGroup, revoked: false });
  pool.state.assignments.push({ id: '9007199254741000', patient: evolutionPatient, subject: careSubject, period: carePeriod, ended: false });
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens);
    const draft = await createDraft(base, author);
    const submitted = await submit(base, author, draft.id);
    assert.equal(submitted.status, 201, await submitted.clone().text());
    const snapshot = await submitted.json();
    const teacherId = '30000000-0000-4000-8000-000000000002';
    const teacher = await tokenFor(tokens, 'teacher', teacherId, ['kinesiology-evolutions:read', 'kinesiology-evolutions:review']);
    pool.state.grantsByRole.teacher = ['kinesiology-evolutions:read'];
    const noReview = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id, reason: 'No permission' }),
    });
    assert.equal(noReview.status, 403);
    assert.deepEqual(await noReview.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evolutions:review' required" } });
    assert.equal(pool.state.commits, 2);
    assert.equal(pool.state.rollbacks, 0);
    pool.state.grantsByRole.teacher.push('kinesiology-evolutions:review');
    pool.state.teacherPeriods[0].revoked = true;
    const revokedContext = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id, reason: 'No longer authorized' }),
    });
    assert.equal(revokedContext.status, 404);
    assert.deepEqual(await revokedContext.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    assert.equal(pool.state.corrections.length, 0);
    assert.equal(pool.state.rollbacks, 1);
    pool.state.teacherPeriods[0].revoked = false;
    const beforeInvalidReason = structuredClone({ evolution: pool.state.evolutions[0], submissions: pool.state.submissions, corrections: pool.state.corrections });
    const blankReason = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id, reason: '  ' }),
    });
    assert.equal(blankReason.status, 400);
    assert.deepEqual(await blankReason.json(), { error: { code: 'BAD_REQUEST', message: 'reason must be a non-empty string' } });
    assert.deepEqual({ evolution: pool.state.evolutions[0], submissions: pool.state.submissions, corrections: pool.state.corrections }, beforeInvalidReason);
    pool.state.failUpdate = true;
    const failedCorrection = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id, reason: 'Rollback on failed reopen' }),
    });
    assert.equal(failedCorrection.status, 409);
    assert.deepEqual(await failedCorrection.json(), { error: { code: 'CONFLICT', message: 'evolution is not awaiting correction' } });
    assert.deepEqual({ evolution: pool.state.evolutions[0], submissions: pool.state.submissions, corrections: pool.state.corrections }, beforeInvalidReason);
    assert.equal(pool.state.rollbacks, 2);
    pool.state.failUpdate = false;
    const correction = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id, reason: 'Please clarify the treatment' }),
    });
    assert.equal(correction.status, 201, await correction.clone().text());
    const request = await correction.json();
    assert.deepEqual(request, { evolution_id: draft.id, submission_id: snapshot.id, status: 'draft',
      correction_request_id: '1', reason: 'Please clarify the treatment', reviewed_by: '30000000-0000-4000-8000-000000000002',
      requested_at: '2026-02-28T12:00:00.000Z' });
    assert.equal(pool.state.evolutions[0].status, 'draft');
    assert.deepEqual(pool.state.evolutions[0].content, complete);
    assert.deepEqual(pool.state.submissions[0].content, complete);
    const correctionHistory = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { headers: headers(teacher) });
    assert.equal(correctionHistory.status, 200);
    assert.deepEqual((await correctionHistory.json()).items, [{ submission_id: snapshot.id, reason: 'Please clarify the treatment',
      reviewed_by: teacherId, requested_at: '2026-02-28T12:00:00.000Z' }]);

    const care = await tokenFor(tokens, 'estudiante', careActor);
    const detail = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { headers: headers(care) });
    assert.equal(detail.status, 200, await detail.clone().text());
    const projected = await detail.json();
    assert.equal(projected.status, 'submitted');
    assert.deepEqual(projected.content, complete);
    assert.equal(projected.submission_id, snapshot.id);
    const history = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(care) });
    assert.equal(history.status, 200);
    assert.deepEqual((await history.json()).items, [snapshot]);
    const currentCareCorrections = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { headers: headers(care) });
    assert.equal(currentCareCorrections.status, 404);
    assert.deepEqual(await currentCareCorrections.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    const careList = await fetch(`${base}/kinesiology-evolutions?patient_id=${evolutionPatient}`, { headers: headers(care) });
    assert.equal(careList.status, 200);
    assert.equal((await careList.json()).items[0].status, 'submitted');

    const edited = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { method: 'PATCH', headers: headers(author),
      body: JSON.stringify({ content: { ...complete, current_status: 'Updated after review' } }) });
    assert.equal(edited.status, 200, await edited.clone().text());
    const resubmitted = await submit(base, author, draft.id);
    assert.equal(resubmitted.status, 201, await resubmitted.clone().text());
    const latest = await resubmitted.json();
    assert.equal(latest.ordinal, '2');
    assert.equal(latest.submitted_by, evolutionActor);
    assert.equal(pool.state.submissions[0].content.current_status, 'Stable');

    const staleCorrection = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id, reason: 'Stale snapshot' }),
    });
    assert.equal(staleCorrection.status, 409);
    assert.deepEqual(await staleCorrection.json(), { error: { code: 'CONFLICT', message: 'submission is not the latest version' } });
    const staleValidation = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id }),
    });
    assert.equal(staleValidation.status, 409);
    assert.deepEqual(await staleValidation.json(), { error: { code: 'CONFLICT', message: 'submission is not the latest version' } });
    assert.equal(pool.state.reviews.length, 0);
    assert.equal(pool.state.corrections.length, 1);

    const validation = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: latest.id }),
    });
    assert.equal(validation.status, 201, await validation.clone().text());
    assert.deepEqual(await validation.json(), { evolution_id: draft.id, submission_id: latest.id, status: 'validated',
      reviewed_by: '30000000-0000-4000-8000-000000000002', reviewed_at: '2026-02-28T12:00:00.000Z' });
    assert.equal(pool.state.submissions.length, 2);
    assert.equal(pool.state.evolutions[0].status, 'validated');
    assert.equal(pool.state.commits, 6);
    assert.equal(pool.state.rollbacks, 4);
    assert.equal(pool.state.releases, 10);
  });
});

test('validation accepts only the latest submitted snapshot and records the active reviewer', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens);
    const draft = await createDraft(base, author);
    const submitted = await submit(base, author, draft.id);
    const snapshot = await submitted.json();
    const teacherId = '30000000-0000-4000-8000-000000000002';
    const teacher = await tokenFor(tokens, 'teacher', teacherId, ['kinesiology-evolutions:read', 'kinesiology-evolutions:review']);
    pool.state.failUpdate = true;
    const failedValidation = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id }),
    });
    assert.equal(failedValidation.status, 409);
    assert.deepEqual(await failedValidation.json(), { error: { code: 'CONFLICT', message: 'evolution is not awaiting validation' } });
    assert.equal(pool.state.evolutions[0].status, 'submitted');
    assert.deepEqual(pool.state.reviews, []);
    assert.equal(pool.state.rollbacks, 1);
    pool.state.failUpdate = false;
    const validation = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id }),
    });
    assert.equal(validation.status, 201, await validation.clone().text());
    assert.deepEqual(await validation.json(), { evolution_id: draft.id, submission_id: snapshot.id, status: 'validated',
      reviewed_by: teacherId, reviewed_at: '2026-02-28T12:00:00.000Z' });
    assert.equal(pool.state.evolutions[0].status, 'validated');
    assert.deepEqual(pool.state.reviews, [{ evolution_id: draft.id, submission_id: snapshot.id, reviewed_by: teacherId,
      teacher_habilitation_id: '62000000-0000-4000-8000-000000000002', reviewed_at: '2026-02-28T12:00:00Z' }]);
    const history = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(author) });
    assert.deepEqual((await history.json()).items, [{ ...snapshot, validation_status: 'validated', reviewed_by: teacherId,
      reviewed_at: '2026-02-28T12:00:00.000Z' }]);
    assert.equal(pool.state.commits, 3);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.releases, 4);
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
