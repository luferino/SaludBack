import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evolutionActor, evolutionPatient, evolutionSubject, evolutionGroup, evolutionGrants, withEvolutionServer,
} from '../helpers/evolution-http.js';
import { evolutionSyntheticPool } from '../helpers/evolution-synthetic-pool.js';

const complete = {
  session_date: '2026-02-28', current_status: 'Stable', objectives: 'Improve mobility', planned_treatment: 'Guided exercise',
};
const headers = token => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const tokenFor = (tokens, role, actor, permissions) => tokens.sign({ role, sub: actor, username: role, permissions });
const originTeacher = '30000000-0000-4000-8000-000000000002';
const reviewPermissions = ['kinesiology-evolutions:read', 'kinesiology-evolutions:review'];
const seededSnapshotId = '9007199254740996';
function seedSubmitted(pool) {
  const row = { id: '9007199254740995', clinical_record_id: '9007199254740994', evaluation_id: '9007199254740993',
    patient_id: evolutionPatient, author_id: evolutionActor, origin_student_habilitation_id: '60000000-0000-4000-8000-000000000001',
    origin_subject_id: evolutionSubject, origin_group_id: evolutionGroup, content: complete, status: 'submitted',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' };
  pool.state.evolutions.push(row);
  pool.state.submissions.push({ id: seededSnapshotId, evolution_id: row.id, ordinal: '1', submitted_by: evolutionActor,
    submitted_at: '2026-01-02T00:00:00Z', content: complete });
  return row;
}
const reviewState = pool => structuredClone({ evolutions: pool.state.evolutions, submissions: pool.state.submissions,
  corrections: pool.state.corrections, reviews: pool.state.reviews });

async function createDraft(base, token) {
  const response = await fetch(`${base}/kinesiology-evolutions`, {
    method: 'POST', headers: headers(token), body: JSON.stringify({ patient_id: evolutionPatient,
      evaluation_id: '9007199254740993', subject_id: evolutionSubject, academic_group_id: evolutionGroup, content: complete }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

async function submit(base, token, id) {
  return fetch(`${base}/kinesiology-evolutions/${id}/submissions`, {
    method: 'POST', headers: headers(token), body: '{}',
  });
}

test('public history stays valid with empty/latest alias joins and omits nullable review facts', async () => {
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
    const author = await tokenFor(tokens, 'estudiante', evolutionActor, evolutionGrants);
    const draft = await createDraft(base, author);
    const emptyHistory = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(author) });
    assert.equal(emptyHistory.status, 200, await emptyHistory.clone().text());
    assert.deepEqual(await emptyHistory.json(), { evolution_id: draft.id, items: [] });

    const firstResponse = await submit(base, author, draft.id);
    assert.equal(firstResponse.status, 201, await firstResponse.clone().text());
    const first = await firstResponse.json();
    const care = await tokenFor(tokens, 'estudiante', careActor, evolutionGrants);
    const originHistory = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(author) });
    assert.deepEqual((await originHistory.json()).items, [first]);
    const careHistory = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(care) });
    assert.deepEqual((await careHistory.json()).items, [first]);
    assert.equal(Object.hasOwn((await (await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(author) })).json()).items[0], 'reviewed_by'), false);

    const teacherId = '30000000-0000-4000-8000-000000000002';
    const teacher = await tokenFor(tokens, 'teacher', teacherId, ['kinesiology-evolutions:read', 'kinesiology-evolutions:review']);
    const corrected = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, {
      method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: first.id, reason: 'Clarify treatment details' }),
    });
    assert.equal(corrected.status, 201, await corrected.clone().text());
    const duringCorrection = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(care) });
    assert.deepEqual((await duringCorrection.json()).items, [first]);
    const hiddenReasons = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { headers: headers(care) });
    assert.equal(hiddenReasons.status, 404);

    const edit = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { method: 'PATCH', headers: headers(author),
      body: JSON.stringify({ content: { ...complete, current_status: 'Updated after correction' } }) });
    assert.equal(edit.status, 200, await edit.clone().text());
    const secondResponse = await submit(base, author, draft.id);
    assert.equal(secondResponse.status, 201, await secondResponse.clone().text());
    const second = await secondResponse.json();
    const originAfterResubmit = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(author) });
    assert.deepEqual((await originAfterResubmit.json()).items.map(item => item.id), [first.id, second.id]);
    const careAfterResubmit = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { headers: headers(care) });
    const careItems = (await careAfterResubmit.json()).items;
    assert.deepEqual(careItems, [second]);
    assert.equal(careItems[0].content.current_status, 'Updated after correction');
    assert.equal(JSON.stringify(careItems).includes('Clarify treatment details'), false);

    const latestAliasQueries = pool.state.queries.filter(query => /\blatest\./i.test(query.sql));
    assert.ok(latestAliasQueries.length >= 4, `expected empty, origin, and current-care history SQL; got ${latestAliasQueries.length}`);
    assert.ok(latestAliasQueries.every(query => /\)\s*latest\s+ON\s+true/i.test(query.sql)),
      'every SQL use of latest.* must define the lateral latest alias');
  });
});

test('teacher correction rejects reviewer claims in the body before any correction write', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens, 'estudiante', evolutionActor, evolutionGrants);
    const draft = await createDraft(base, author);
    const snapshot = await (await submit(base, author, draft.id)).json();
    const teacher = await tokenFor(tokens, 'teacher', originTeacher, reviewPermissions);
    const before = reviewState(pool);
    const spoofed = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: snapshot.id, reason: 'Correction', reviewed_by: evolutionActor }) });
    assert.equal(spoofed.status, 400);
    assert.deepEqual(await spoofed.json(), { error: { code: 'BAD_REQUEST', message: 'body may contain only submission_id and reason' } });
    assert.deepEqual(reviewState(pool), before);
  });
});

test('validation of an unknown submission is not found and stale or unknown review targets leave state unchanged', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens, 'estudiante', evolutionActor, evolutionGrants);
    const teacher = await tokenFor(tokens, 'teacher', originTeacher, reviewPermissions);
    const draft = await createDraft(base, author);
    const first = await (await submit(base, author, draft.id)).json();
    const corrected = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: first.id, reason: 'Clarify treatment details' }) });
    assert.equal(corrected.status, 201, await corrected.clone().text());
    const edited = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { method: 'PATCH', headers: headers(author),
      body: JSON.stringify({ content: { ...complete, current_status: 'Updated after correction' } }) });
    assert.equal(edited.status, 200, await edited.clone().text());
    const second = await (await submit(base, author, draft.id)).json();
    assert.equal(second.ordinal, '2');
    const beforeStale = reviewState(pool);
    const stale = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: first.id, reason: 'Stale target' }) });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: { code: 'CONFLICT', message: 'submission is not the latest version' } });
    const unknown = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: '9007199254740999' }) });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: { code: 'NOT_FOUND', message: 'submission was not found' } });
    assert.deepEqual(reviewState(pool), beforeStale);
  });
});

test('validated evolution rejects repeat validation, repeat submit and repeat correction through repository status checks', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens, 'estudiante', evolutionActor, evolutionGrants);
    const teacher = await tokenFor(tokens, 'teacher', originTeacher, reviewPermissions);
    const draft = await createDraft(base, author);
    const first = await (await submit(base, author, draft.id)).json();
    await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: first.id, reason: 'Clarify treatment details' }) });
    const edited = await fetch(`${base}/kinesiology-evolutions/${draft.id}`, { method: 'PATCH', headers: headers(author),
      body: JSON.stringify({ content: { ...complete, current_status: 'Updated after correction' } }) });
    assert.equal(edited.status, 200, await edited.clone().text());
    const second = await (await submit(base, author, draft.id)).json();
    const validation = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: second.id }) });
    assert.equal(validation.status, 201, await validation.clone().text());
    const repeatedValidation = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: second.id }) });
    assert.equal(repeatedValidation.status, 409);
    assert.deepEqual(await repeatedValidation.json(), { error: { code: 'CONFLICT', message: 'evolution is not awaiting validation' } });
    const repeatedSubmit = await submit(base, author, draft.id);
    assert.equal(repeatedSubmit.status, 409);
    assert.deepEqual(await repeatedSubmit.json(), { error: { code: 'CONFLICT', message: 'evolution is not an editable draft' } });
    const repeatedCorrection = await fetch(`${base}/kinesiology-evolutions/${draft.id}/corrections`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: second.id, reason: 'After validation' }) });
    assert.equal(repeatedCorrection.status, 409);
    assert.deepEqual(await repeatedCorrection.json(), { error: { code: 'CONFLICT', message: 'evolution is not awaiting correction' } });
    assert.equal(pool.state.evolutions[0].status, 'validated');
    assert.equal(pool.state.submissions.length, 2);
    assert.equal(pool.state.corrections.length, 1);
    assert.equal(pool.state.reviews.length, 1);
  });
});

test('validation database failure after the review insert returns 500 and rolls back the review', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens, 'estudiante', evolutionActor, evolutionGrants);
    const draft = await createDraft(base, author);
    const snapshot = await (await submit(base, author, draft.id)).json();
    pool.state.failOnValidationTransition = true;
    const teacher = await tokenFor(tokens, 'teacher', originTeacher, reviewPermissions);
    const response = await fetch(`${base}/kinesiology-evolutions/${draft.id}/validations`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: snapshot.id }) });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
  });
  assert.equal(pool.state.evolutions[0].status, 'submitted');
  assert.equal(pool.state.reviews.length, 0);
  assert.equal(pool.state.corrections.length, 0);
  assert.equal(pool.state.submissions.length, 1);
  assert.equal(pool.state.commits, 2);
  assert.equal(pool.state.rollbacks, 1);
  assert.equal(pool.state.releases, 3);
});

test('origin teacher validates a former author snapshot after assignment end without restoring the former author edit access', async () => {
  const pool = evolutionSyntheticPool();
  const row = seedSubmitted(pool);
  pool.state.assignments = [];
  await withEvolutionServer(pool, async (base, tokens) => {
    const former = await tokenFor(tokens, 'estudiante', evolutionActor, evolutionGrants);
    const teacher = await tokenFor(tokens, 'teacher', originTeacher, reviewPermissions);
    const validation = await fetch(`${base}/kinesiology-evolutions/${row.id}/validations`, { method: 'POST', headers: headers(teacher),
      body: JSON.stringify({ submission_id: seededSnapshotId }) });
    assert.equal(validation.status, 201, await validation.clone().text());
    assert.equal(pool.state.evolutions[0].status, 'validated');
    const before = structuredClone({ evolution: pool.state.evolutions[0], reviews: pool.state.reviews });
    const edit = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { method: 'PATCH', headers: headers(former),
      body: JSON.stringify({ content: { ...complete, objectives: 'Unauthorized edit' } }) });
    assert.equal(edit.status, 404);
    assert.deepEqual(await edit.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    assert.deepEqual({ evolution: pool.state.evolutions[0], reviews: pool.state.reviews }, before);
  });
});

test('validation without teacher context or in another group is not found and writes nothing', async () => {
  for (const mutate of [
    state => { state.teacherPeriods = []; },
    state => { state.teacherPeriods[0].group = '20000000-0000-4000-8000-000000000099'; },
  ]) {
    const pool = evolutionSyntheticPool();
    seedSubmitted(pool);
    mutate(pool.state);
    await withEvolutionServer(pool, async (base, tokens) => {
      const teacher = await tokenFor(tokens, 'teacher', originTeacher, reviewPermissions);
      const response = await fetch(`${base}/kinesiology-evolutions/9007199254740995/validations`, { method: 'POST', headers: headers(teacher),
        body: JSON.stringify({ submission_id: seededSnapshotId }) });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    });
    assert.equal(pool.state.evolutions[0].status, 'submitted');
    assert.deepEqual(pool.state.reviews, []);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.releases, 1);
  }
});

test('admin role with spoofed review permission cannot validate and never opens a transaction', async () => {
  const pool = evolutionSyntheticPool();
  seedSubmitted(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const admin = await tokenFor(tokens, 'admin', '30000000-0000-0000-0000-000000000003', [...evolutionGrants, 'kinesiology-evolutions:review']);
    const response = await fetch(`${base}/kinesiology-evolutions/9007199254740995/validations`, { method: 'POST', headers: headers(admin),
      body: JSON.stringify({ submission_id: seededSnapshotId }) });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evolutions:review' required" } });
  });
  assert.equal(pool.state.queries.some(query => query.sql === 'BEGIN'), false);
  assert.deepEqual(pool.state.reviews, []);
  assert.equal(pool.state.evolutions[0].status, 'submitted');
});

test('current-care detail shows only the latest submitted snapshot while origin teacher history keeps both versions', async () => {
  const pool = evolutionSyntheticPool();
  const careActor = '30000000-0000-4000-8000-000000000006';
  const careProfile = '31000000-0000-4000-8000-000000000006';
  const carePeriod = '60000000-0000-4000-8000-000000000006';
  const careSubject = '10000000-0000-4000-8000-000000000006';
  const careGroup = '20000000-0000-4000-8000-000000000006';
  pool.state.profiles.set(careActor, careProfile);
  pool.state.periods.push({ id: carePeriod, studentId: careProfile, subject: careSubject, group: careGroup, revoked: false });
  pool.state.assignments.push({ id: '9007199254741000', patient: evolutionPatient, subject: careSubject, period: carePeriod, ended: false });
  const row = seedSubmitted(pool);
  row.status = 'draft';
  row.content = { current_status: 'private correction draft' };
  row.updated_at = '2026-01-03T00:00:00Z';
  pool.state.submissions = [
    { id: seededSnapshotId, evolution_id: row.id, ordinal: '1', submitted_by: evolutionActor, submitted_at: '2026-01-02T00:00:00Z',
      content: { ...complete, current_status: 'older snapshot' } },
    { id: '9007199254740997', evolution_id: row.id, ordinal: '2', submitted_by: evolutionActor, submitted_at: '2026-01-03T00:00:00Z',
      content: { ...complete, current_status: 'submitted snapshot' } },
  ];
  pool.state.corrections = [{ id: '1', evolution_id: row.id, submission_id: '9007199254740997', reason: 'private teacher correction reason',
    reviewed_by: originTeacher, requested_at: '2026-01-03T00:00:00Z' }];
  await withEvolutionServer(pool, async (base, tokens) => {
    const latest = pool.state.submissions[1];
    const care = await tokenFor(tokens, 'estudiante', careActor, evolutionGrants);
    const detail = await fetch(`${base}/kinesiology-evolutions/${row.id}`, { headers: headers(care) });
    assert.equal(detail.status, 200, await detail.clone().text());
    const body = await detail.json();
    assert.deepEqual(body.content, latest.content);
    assert.equal(body.status, 'submitted');
    assert.equal(body.validation_status, 'pending_validation');
    assert.equal(body.submission_id, latest.id);
    assert.equal(body.submitted_at, new Date(latest.submitted_at).toISOString());
    assert.equal(body.created_at, new Date(latest.submitted_at).toISOString());
    assert.equal(body.updated_at, new Date(latest.submitted_at).toISOString());
    assert.doesNotMatch(JSON.stringify(body), /private correction draft|private teacher correction reason|older snapshot/);
    const teacher = await tokenFor(tokens, 'teacher', originTeacher, ['kinesiology-evolutions:read']);
    const history = await fetch(`${base}/kinesiology-evolutions/${row.id}/submissions`, { headers: headers(teacher) });
    assert.equal(history.status, 200);
    assert.deepEqual((await history.json()).items.map(item => item.id), [seededSnapshotId, '9007199254740997']);
  });
});
