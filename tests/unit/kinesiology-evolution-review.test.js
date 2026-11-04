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
