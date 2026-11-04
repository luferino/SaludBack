import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evolutionActor, evolutionPatient, evolutionSubject, evolutionGroup, evolutionGrants, withEvolutionServer,
} from '../helpers/evolution-http.js';
import { evolutionSyntheticPool } from '../helpers/evolution-synthetic-pool.js';

const content = {
  session_date: '2026-02-28', current_status: 'Stable', objectives: 'Improve mobility', planned_treatment: 'Guided exercise',
};
const headers = token => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const tokenFor = (tokens, actor, permissions, role = 'estudiante') => tokens.sign({ role, sub: actor, username: actor, permissions });

async function post(base, token, path, body = {}) {
  return fetch(`${base}/kinesiology-evolutions${path}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
}
async function get(base, token, path) {
  return fetch(`${base}/kinesiology-evolutions${path}`, { headers: headers(token) });
}
async function patch(base, token, id, body) {
  return fetch(`${base}/kinesiology-evolutions/${id}`, { method: 'PATCH', headers: headers(token), body: JSON.stringify(body) });
}

const teacherActor = '30000000-0000-4000-8000-000000000002';
const teacherGrants = ['kinesiology-evolutions:read', 'kinesiology-evolutions:review'];
const defaultPeriod = '60000000-0000-4000-8000-000000000001';
const otherGroup = '20000000-0000-4000-8000-000000000099';
const replacementStudent = { actor: '30000000-0000-4000-8000-000000000011', profile: '31000000-0000-4000-8000-000000000011',
  period: '60000000-0000-4000-8000-000000000011', assignment: '9007199254741011' };
const readerStudent = { actor: '30000000-0000-4000-8000-000000000006', profile: '31000000-0000-4000-8000-000000000006',
  period: '60000000-0000-4000-8000-000000000006', assignment: '9007199254741006' };
const validatedRow = { id: '9007199254740995', clinical_record_id: '9007199254740994', evaluation_id: '9007199254740993',
  patient_id: evolutionPatient, author_id: evolutionActor, origin_student_habilitation_id: defaultPeriod,
  origin_subject_id: evolutionSubject, origin_group_id: evolutionGroup, content, status: 'validated',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const snapshotRow = { id: '9007199254740996', evolution_id: validatedRow.id, ordinal: '1', submitted_by: evolutionActor,
  submitted_at: '2026-01-02T00:00:00Z', content };
const reviewRow = { evolution_id: validatedRow.id, submission_id: snapshotRow.id, reviewed_by: teacherActor,
  teacher_habilitation_id: '62000000-0000-4000-8000-000000000002', reviewed_at: '2026-01-03T00:00:00Z' };

function seedValidatedOriginal(pool, overrides = {}) {
  pool.state.evolutions.push(structuredClone({ ...validatedRow, ...overrides }));
  pool.state.submissions.push(structuredClone(snapshotRow));
  pool.state.reviews.push(structuredClone(reviewRow));
}

function enrollStudent(pool, { actor, profile, period, assignment }) {
  pool.state.profiles.set(actor, profile);
  pool.state.periods.push({ id: period, studentId: profile, subject: evolutionSubject, group: evolutionGroup, revoked: false });
  pool.state.assignments.push({ id: assignment, patient: evolutionPatient, subject: evolutionSubject, period, ended: false });
}

// Creates a student draft, submits it and records a teacher validation through the public routes.
async function validatedOriginal(base, tokens) {
  const author = await tokenFor(tokens, evolutionActor, evolutionGrants);
  const created = await post(base, author, '', { patient_id: evolutionPatient, evaluation_id: '9007199254740993',
    subject_id: evolutionSubject, academic_group_id: evolutionGroup, content });
  assert.equal(created.status, 201, await created.clone().text());
  const original = await created.json();
  const submittedResponse = await post(base, author, `/${original.id}/submissions`);
  assert.equal(submittedResponse.status, 201, await submittedResponse.clone().text());
  const submitted = await submittedResponse.json();
  const teacher = await tokenFor(tokens, teacherActor, teacherGrants, 'teacher');
  const validation = await fetch(`${base}/kinesiology-evolutions/${original.id}/validations`, {
    method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: submitted.id }),
  });
  assert.equal(validation.status, 201, await validation.clone().text());
  return { original, teacher };
}

// Stored rows and public projections of one original; child rows are excluded so the check proves the original is untouched.
async function originalDocument(pool, base, teacher, id) {
  const detail = await get(base, teacher, `/${id}`);
  const history = await get(base, teacher, `/${id}/submissions`);
  assert.equal(detail.status, 200, await detail.clone().text());
  assert.equal(history.status, 200, await history.clone().text());
  return {
    row: structuredClone(pool.state.evolutions.find(row => row.id === id)),
    submissions: structuredClone(pool.state.submissions.filter(item => item.evolution_id === id)),
    reviews: structuredClone(pool.state.reviews.filter(item => item.evolution_id === id)),
    corrections: structuredClone(pool.state.corrections.filter(item => item.evolution_id === id)),
    detail: await detail.json(),
    history: await history.json(),
  };
}

test('a validated evolution can be amended through the public API and the draft identifies its original', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens, evolutionActor, evolutionGrants);
    const created = await post(base, author, '', { patient_id: evolutionPatient, evaluation_id: '9007199254740993',
      subject_id: evolutionSubject, academic_group_id: evolutionGroup, content });
    assert.equal(created.status, 201, await created.clone().text());
    const original = await created.json();
    const submittedResponse = await post(base, author, `/${original.id}/submissions`);
    assert.equal(submittedResponse.status, 201, await submittedResponse.clone().text());
    const submitted = await submittedResponse.json();
    const teacher = await tokenFor(tokens, '30000000-0000-4000-8000-000000000002',
      ['kinesiology-evolutions:read', 'kinesiology-evolutions:review'], 'teacher');
    const validation = await fetch(`${base}/kinesiology-evolutions/${original.id}/validations`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: submitted.id }),
    });
    assert.equal(validation.status, 201, await validation.clone().text());

    const replacementActor = '30000000-0000-4000-8000-000000000011';
    const replacementProfile = '31000000-0000-4000-8000-000000000011';
    const replacementPeriod = '60000000-0000-4000-8000-000000000011';
    pool.state.profiles.set(replacementActor, replacementProfile);
    pool.state.periods.push({ id: replacementPeriod, studentId: replacementProfile,
      subject: evolutionSubject, group: evolutionGroup, revoked: false });
    pool.state.assignments.push({ id: '9007199254741011', patient: evolutionPatient,
      subject: evolutionSubject, period: replacementPeriod, ended: false });
    const replacement = await tokenFor(tokens, replacementActor, evolutionGrants);
    const amendedResponse = await post(base, replacement, `/${original.id}/amendments`);
    assert.equal(amendedResponse.status, 201, await amendedResponse.clone().text());
    const amendment = await amendedResponse.json();
    assert.equal(amendment.amendment_of_evolution_id, original.id);
    assert.equal(amendment.author_id, replacementActor);
    assert.equal(amendment.patient_id, original.patient_id);
    assert.equal(amendment.evaluation_id, original.evaluation_id);
    assert.equal(amendment.content.session_date, content.session_date);
    assert.equal(amendment.status, 'draft');
    assert.deepEqual(pool.state.evolutions.find(row => row.id === original.id).content, content);
    const amendmentId = amendment.id;
    const amendedContent = { ...content, current_status: 'Updated by replacement author' };
    const edited = await fetch(`${base}/kinesiology-evolutions/${amendmentId}`, { method: 'PATCH', headers: headers(replacement),
      body: JSON.stringify({ content: amendedContent }) });
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.equal((await edited.json()).amendment_of_evolution_id, original.id);
    const amendmentSubmissionResponse = await post(base, replacement, `/${amendmentId}/submissions`);
    assert.equal(amendmentSubmissionResponse.status, 201, await amendmentSubmissionResponse.clone().text());
    const amendmentSubmission = await amendmentSubmissionResponse.json();
    assert.equal(amendmentSubmission.amendment_of_evolution_id, original.id);
    const historyResponse = await fetch(`${base}/kinesiology-evolutions/${amendmentId}/submissions`, { headers: headers(replacement) });
    assert.equal(historyResponse.status, 200, await historyResponse.clone().text());
    const history = await historyResponse.json();
    assert.equal(history.amendment_of_evolution_id, original.id);
    assert.equal(history.items[0].amendment_of_evolution_id, original.id);
    const amendmentValidation = await fetch(`${base}/kinesiology-evolutions/${amendmentId}/validations`, {
      method: 'POST', headers: headers(teacher), body: JSON.stringify({ submission_id: amendmentSubmission.id }),
    });
    assert.equal(amendmentValidation.status, 201, await amendmentValidation.clone().text());
    const detailResponse = await fetch(`${base}/kinesiology-evolutions/${amendmentId}`, { headers: headers(replacement) });
    const detail = await detailResponse.json();
    assert.equal(detail.amendment_of_evolution_id, original.id);
    assert.equal(detail.status, 'validated');
    assert.deepEqual(pool.state.evolutions.find(row => row.id === original.id).content, content);
    assert.equal(pool.state.commits - pool.state.rollbacks, 7);
  });
});

test('amendments reject missing or unvalidated parents without writes and keep route permission enforcement', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const author = await tokenFor(tokens, evolutionActor, evolutionGrants);
    const created = await post(base, author, '', { patient_id: evolutionPatient, evaluation_id: '9007199254740993',
      subject_id: evolutionSubject, academic_group_id: evolutionGroup, content });
    const draft = await created.json();
    const before = structuredClone(pool.state.evolutions);

    const missing = await post(base, author, '/9223372036854775807/amendments');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.message, 'evolution was not found');
    const unvalidated = await post(base, author, `/${draft.id}/amendments`);
    assert.equal(unvalidated.status, 409);
    assert.equal((await unvalidated.json()).error.message, 'evolution is not validated');
    assert.deepEqual(pool.state.evolutions, before);
    assert.equal(pool.state.amendmentLinks.length, 0);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 2);

    const denied = await post(base, await tokenFor(tokens, evolutionActor, [], 'admin'), `/${draft.id}/amendments`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.message, "Permission 'kinesiology-evolutions:write' required");
    const malformed = await post(base, author, `/${draft.id}/amendments`, { reason: 'not an allowed override' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.message, 'body must be an empty object');
    assert.deepEqual(pool.state.evolutions, before);
    const noIdentity = await post(base, await tokenFor(tokens, '30000000-0000-4000-8000-000000000010', evolutionGrants), `/${draft.id}/amendments`);
    assert.equal(noIdentity.status, 404);
    assert.equal((await noIdentity.json()).error.message, 'evolution was not found');
    assert.deepEqual(pool.state.evolutions, before);
    assert.equal(pool.state.amendmentLinks.length, 0);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 3);
  });
});

test('cross-context readers cannot discover an amendment before its first submission', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const { original } = await validatedOriginal(base, tokens);
    enrollStudent(pool, replacementStudent);
    const amendmentResponse = await post(base, await tokenFor(tokens, replacementStudent.actor, evolutionGrants), `/${original.id}/amendments`);
    assert.equal(amendmentResponse.status, 201, await amendmentResponse.clone().text());
    const amendment = await amendmentResponse.json();
    enrollStudent(pool, readerStudent);
    const reader = await tokenFor(tokens, readerStudent.actor, evolutionGrants);

    const originalDetail = await get(base, reader, `/${original.id}`);
    assert.equal(originalDetail.status, 200, await originalDetail.clone().text());
    const amendmentDetail = await get(base, reader, `/${amendment.id}`);
    assert.equal(amendmentDetail.status, 404);
    assert.deepEqual(await amendmentDetail.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
    const list = await get(base, reader, `?patient_id=${evolutionPatient}`);
    assert.equal(list.status, 200, await list.clone().text());
    assert.deepEqual((await list.json()).items.map(item => item.id), [original.id]);
  });
});

test('denied amendment creation leaves parents, snapshots, reviews, links and counters unchanged', async () => {
  const draftAndSubmitted = ['draft', 'submitted'];
  for (const status of draftAndSubmitted) {
    const pool = evolutionSyntheticPool();
    pool.state.evolutions.push(structuredClone({ ...validatedRow, status }));
    await withEvolutionServer(pool, async (base, tokens) => {
      const response = await post(base, await tokenFor(tokens, evolutionActor, evolutionGrants), `/${validatedRow.id}/amendments`);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: { code: 'CONFLICT', message: 'evolution is not validated' } });
    });
    assert.deepEqual(pool.state.evolutions, [{ ...validatedRow, status }]);
    assert.deepEqual(pool.state.amendmentLinks, []);
    assert.equal(pool.state.commits, 0);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.releases, 1);
  }

  const denials = [
    { name: 'missing parent', id: '9007199254740998', status: 404, transactional: true,
      error: { code: 'NOT_FOUND', message: 'evolution was not found' } },
    { name: 'absent origin period', prepare: pool => pool.state.periods.splice(0), status: 404, transactional: true,
      error: { code: 'NOT_FOUND', message: 'evolution was not found' } },
    { name: 'absent assignment', prepare: pool => pool.state.assignments.splice(0), status: 404, transactional: true,
      error: { code: 'NOT_FOUND', message: 'evolution was not found' } },
    { name: 'wrong origin context', row: { origin_group_id: otherGroup }, status: 404, transactional: true,
      error: { code: 'NOT_FOUND', message: 'evolution was not found' } },
    { name: 'spoofed author body', body: { author_id: replacementStudent.actor }, status: 400, transactional: false,
      error: { code: 'BAD_REQUEST', message: 'body must be an empty object' } },
    { name: 'admin without write grant', role: 'admin', permissions: [], status: 403, transactional: false,
      error: { code: 'FORBIDDEN', message: "Permission 'kinesiology-evolutions:write' required" } },
  ];
  for (const denial of denials) {
    const pool = evolutionSyntheticPool();
    seedValidatedOriginal(pool, denial.row);
    denial.prepare?.(pool);
    const before = structuredClone({ evolutions: pool.state.evolutions, submissions: pool.state.submissions,
      reviews: pool.state.reviews, links: pool.state.amendmentLinks });
    await withEvolutionServer(pool, async (base, tokens) => {
      const token = await tokenFor(tokens, evolutionActor, denial.permissions ?? evolutionGrants, denial.role ?? 'estudiante');
      const response = await post(base, token, `/${denial.id ?? validatedRow.id}/amendments`, denial.body ?? {});
      assert.equal(response.status, denial.status, `${denial.name}: ${await response.clone().text()}`);
      assert.deepEqual(await response.json(), { error: denial.error });
    });
    assert.deepEqual({ evolutions: pool.state.evolutions, submissions: pool.state.submissions,
      reviews: pool.state.reviews, links: pool.state.amendmentLinks }, before, denial.name);
    assert.equal(pool.state.commits, 0, denial.name);
    assert.equal(pool.state.rollbacks, denial.transactional ? 1 : 0, denial.name);
    assert.equal(pool.state.releases, denial.transactional ? 1 : 0, denial.name);
  }
});

test('locked amendment revalidation rejects raced identity or status changes without writes', async () => {
  const races = [
    { change: { patient_id: '70000000-0000-4000-8000-000000000099' }, status: 404,
      error: { code: 'NOT_FOUND', message: 'evolution was not found' } },
    { change: { status: 'submitted' }, status: 409,
      error: { code: 'CONFLICT', message: 'evolution is not validated' } },
  ];
  for (const race of races) {
    const pool = evolutionSyntheticPool();
    seedValidatedOriginal(pool);
    pool.state.mutateBeforeLock = race.change;
    const before = structuredClone({ evolutions: pool.state.evolutions, submissions: pool.state.submissions,
      reviews: pool.state.reviews, links: pool.state.amendmentLinks });
    await withEvolutionServer(pool, async (base, tokens) => {
      const response = await post(base, await tokenFor(tokens, evolutionActor, evolutionGrants), `/${validatedRow.id}/amendments`);
      assert.equal(response.status, race.status);
      assert.deepEqual(await response.json(), { error: race.error });
    });
    assert.deepEqual({ evolutions: pool.state.evolutions, submissions: pool.state.submissions,
      reviews: pool.state.reviews, links: pool.state.amendmentLinks }, before);
    assert.equal(pool.state.commits, 0);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.releases, 1);
  }
});

test('amendment creation returns a distinct child bound to the replacement period with the reviewed content', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const { original } = await validatedOriginal(base, tokens);
    enrollStudent(pool, replacementStudent);
    const response = await post(base, await tokenFor(tokens, replacementStudent.actor, evolutionGrants), `/${original.id}/amendments`);
    assert.equal(response.status, 201, await response.clone().text());
    const amendment = await response.json();
    assert.notEqual(amendment.id, original.id);
    assert.equal(amendment.amendment_of_evolution_id, original.id);
    assert.equal(amendment.author_id, replacementStudent.actor);
    assert.equal(amendment.origin_student_habilitation_id, replacementStudent.period);
    assert.equal(amendment.status, 'draft');
    assert.deepEqual(amendment.content, content);
    assert.deepEqual(pool.state.amendmentLinks.map(({ amendment_evolution_id, original_evolution_id }) => ({ amendment_evolution_id, original_evolution_id })),
      [{ amendment_evolution_id: amendment.id, original_evolution_id: original.id }]);
  });
});

test('amendment correction and resubmission keep parent metadata while the original document stays immutable', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const { original, teacher } = await validatedOriginal(base, tokens);
    enrollStudent(pool, replacementStudent);
    const replacement = await tokenFor(tokens, replacementStudent.actor, evolutionGrants);
    const originalBefore = await originalDocument(pool, base, teacher, original.id);

    const amendmentResponse = await post(base, replacement, `/${original.id}/amendments`);
    assert.equal(amendmentResponse.status, 201, await amendmentResponse.clone().text());
    const amendment = await amendmentResponse.json();
    const teacherEdit = await patch(base, teacher, amendment.id, { content });
    assert.equal(teacherEdit.status, 403);
    const draftDetail = await get(base, replacement, `/${amendment.id}`);
    assert.equal(draftDetail.status, 200, await draftDetail.clone().text());
    assert.equal((await draftDetail.json()).amendment_of_evolution_id, original.id);

    const submittedResponse = await post(base, replacement, `/${amendment.id}/submissions`);
    assert.equal(submittedResponse.status, 201, await submittedResponse.clone().text());
    const versionOne = await submittedResponse.json();
    assert.equal(versionOne.amendment_of_evolution_id, original.id);
    const correction = await fetch(`${base}/kinesiology-evolutions/${amendment.id}/corrections`, { method: 'POST',
      headers: headers(teacher), body: JSON.stringify({ submission_id: versionOne.id, reason: 'Clarify amendment' }) });
    assert.equal(correction.status, 201, await correction.clone().text());
    assert.equal((await correction.json()).amendment_of_evolution_id, original.id);

    const edit = await patch(base, replacement, amendment.id, { content: { ...content, objectives: 'Corrected amendment' } });
    assert.equal(edit.status, 200, await edit.clone().text());
    assert.equal((await edit.json()).amendment_of_evolution_id, original.id);
    const resubmittedResponse = await post(base, replacement, `/${amendment.id}/submissions`);
    assert.equal(resubmittedResponse.status, 201, await resubmittedResponse.clone().text());
    const versionTwo = await resubmittedResponse.json();
    assert.equal(versionTwo.amendment_of_evolution_id, original.id);
    assert.equal(versionTwo.ordinal, '2');
    const validation = await fetch(`${base}/kinesiology-evolutions/${amendment.id}/validations`, { method: 'POST',
      headers: headers(teacher), body: JSON.stringify({ submission_id: versionTwo.id }) });
    assert.equal(validation.status, 201, await validation.clone().text());

    const history = await get(base, replacement, `/${amendment.id}/submissions`);
    assert.equal(history.status, 200, await history.clone().text());
    const historyBody = await history.json();
    assert.equal(historyBody.amendment_of_evolution_id, original.id);
    assert.deepEqual(historyBody.items.map(item => item.id), [versionOne.id, versionTwo.id]);
    assert.deepEqual(pool.state.amendmentLinks.map(link => link.original_evolution_id), [original.id]);
    assert.deepEqual(await originalDocument(pool, base, teacher, original.id), originalBefore);
  });
});

test('current-care readers see the parent link on the latest submitted amendment snapshot, not its correction draft', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const { original, teacher } = await validatedOriginal(base, tokens);
    enrollStudent(pool, replacementStudent);
    const replacement = await tokenFor(tokens, replacementStudent.actor, evolutionGrants);
    const amendmentResponse = await post(base, replacement, `/${original.id}/amendments`);
    assert.equal(amendmentResponse.status, 201, await amendmentResponse.clone().text());
    const amendment = await amendmentResponse.json();
    const submittedResponse = await post(base, replacement, `/${amendment.id}/submissions`);
    assert.equal(submittedResponse.status, 201, await submittedResponse.clone().text());
    const snapshot = await submittedResponse.json();
    const correction = await fetch(`${base}/kinesiology-evolutions/${amendment.id}/corrections`, { method: 'POST',
      headers: headers(teacher), body: JSON.stringify({ submission_id: snapshot.id, reason: 'private teacher correction reason' }) });
    assert.equal(correction.status, 201, await correction.clone().text());
    const privateEdit = await patch(base, replacement, amendment.id, { content: { ...content, current_status: 'private correction draft' } });
    assert.equal(privateEdit.status, 200, await privateEdit.clone().text());

    enrollStudent(pool, readerStudent);
    const reader = await tokenFor(tokens, readerStudent.actor, evolutionGrants);
    const detail = await get(base, reader, `/${amendment.id}`);
    assert.equal(detail.status, 200, await detail.clone().text());
    const body = await detail.json();
    assert.equal(body.amendment_of_evolution_id, original.id);
    assert.equal(body.status, 'submitted');
    assert.equal(body.submission_id, snapshot.id);
    assert.deepEqual(body.content, snapshot.content);
    assert.doesNotMatch(JSON.stringify(body), /private correction draft|private teacher correction reason/);
    const list = await get(base, reader, `?patient_id=${evolutionPatient}`);
    assert.equal(list.status, 200, await list.clone().text());
    const listed = (await list.json()).items.find(item => item.id === amendment.id);
    assert.equal(listed.amendment_of_evolution_id, original.id);
    assert.deepEqual(listed.content, snapshot.content);
    const history = await get(base, reader, `/${amendment.id}/submissions`);
    assert.equal(history.status, 200, await history.clone().text());
    const versions = await history.json();
    assert.equal(versions.amendment_of_evolution_id, original.id);
    assert.equal(versions.items.length, 1);
    assert.equal(versions.items[0].id, snapshot.id);
    assert.equal(versions.items[0].amendment_of_evolution_id, original.id);
    const hiddenCorrections = await get(base, reader, `/${amendment.id}/corrections`);
    assert.equal(hiddenCorrections.status, 404);
    assert.deepEqual(await hiddenCorrections.json(), { error: { code: 'NOT_FOUND', message: 'evolution was not found' } });
  });
});

test('amendment link insert failure rolls back the child and reports a generic server error', async () => {
  const pool = evolutionSyntheticPool();
  await withEvolutionServer(pool, async (base, tokens) => {
    const { original } = await validatedOriginal(base, tokens);
    enrollStudent(pool, replacementStudent);
    const replacement = await tokenFor(tokens, replacementStudent.actor, evolutionGrants);
    const before = structuredClone({ evolutions: pool.state.evolutions, submissions: pool.state.submissions,
      reviews: pool.state.reviews, corrections: pool.state.corrections, links: pool.state.amendmentLinks,
      commits: pool.state.commits, rollbacks: pool.state.rollbacks });
    const releasesBefore = pool.state.releases;
    pool.state.failAmendmentLink = true;

    const failed = await post(base, replacement, `/${original.id}/amendments`);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
    assert.deepEqual({ evolutions: pool.state.evolutions, submissions: pool.state.submissions,
      reviews: pool.state.reviews, corrections: pool.state.corrections, links: pool.state.amendmentLinks,
      commits: pool.state.commits, rollbacks: pool.state.rollbacks }, { ...before, rollbacks: before.rollbacks + 1 });
    assert.equal(pool.state.releases, releasesBefore + 1);
  });
});
