import test from 'node:test';
import assert from 'node:assert/strict';
import { evolutionActor, evolutionPatient, evolutionSubject, evolutionGroup, evolutionGrants, withEvolutionServer } from '../helpers/evolution-http.js';
import { evolutionSyntheticPool, odontologySubject, odontologyGroup, SAME_CAREER_JOIN } from '../helpers/evolution-synthetic-pool.js';

const complete = { session_date: '2026-02-28', current_status: 'Stable', objectives: 'Improve mobility', planned_treatment: 'Guided exercise' };
const draftRequest = { patient_id: evolutionPatient, evaluation_id: '9007199254740993', subject_id: evolutionSubject,
  academic_group_id: evolutionGroup, content: complete };
const odontologyStudent = '30000000-0000-4000-8000-000000000003';
const odontologyStudentProfile = '31000000-0000-4000-8000-000000000003';
const odontologyPeriod = '60000000-0000-4000-8000-000000000003';
const odontologyTeacher = '30000000-0000-4000-8000-000000000004';
const odontologyTeacherId = '32000000-0000-4000-8000-000000000004';
const kinesiologyPeer = '30000000-0000-4000-8000-000000000005';
const kinesiologyPeerProfile = '31000000-0000-4000-8000-000000000005';
const kinesiologyPeerSubject = '10000000-0000-4000-8000-000000000005';
const kinesiologyPeerPeriod = '60000000-0000-4000-8000-000000000005';
const stranger = '30000000-0000-4000-8000-000000000006';
const notFound = { error: { code: 'NOT_FOUND', message: 'evolution was not found' } };

const headers = token => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const signed = (tokens, sub, role = 'estudiante', permissions = evolutionGrants) => tokens.sign({ role, sub, username: role, permissions });
const read = (base, token, path) => fetch(`${base}${path}`, { headers: headers(token) });

function addOdontologyStudent(pool) {
  pool.state.profiles.set(odontologyStudent, odontologyStudentProfile);
  pool.state.periods.push({ id: odontologyPeriod, studentId: odontologyStudentProfile, subject: odontologySubject, group: odontologyGroup, revoked: false });
  pool.state.assignments.push({ id: '9007199254740999', patient: evolutionPatient, subject: odontologySubject, period: odontologyPeriod, ended: false });
}
function addOdontologyTeacher(pool) {
  pool.state.teachers.set(odontologyTeacher, odontologyTeacherId);
  pool.state.teacherPeriods.push({ id: '62000000-0000-4000-8000-000000000004', teacherId: odontologyTeacherId, subject: odontologySubject, group: odontologyGroup, revoked: false });
}
function addKinesiologyPeer(pool) {
  pool.state.profiles.set(kinesiologyPeer, kinesiologyPeerProfile);
  pool.state.periods.push({ id: kinesiologyPeerPeriod, studentId: kinesiologyPeerProfile, subject: kinesiologyPeerSubject, group: evolutionGroup, revoked: false });
  pool.state.assignments.push({ id: '9007199254741000', patient: evolutionPatient, subject: kinesiologyPeerSubject, period: kinesiologyPeerPeriod, ended: false });
}
async function createSubmitted(base, tokens) {
  const author = await signed(tokens, evolutionActor, 'estudiante', [...evolutionGrants, 'kinesiology-evolutions:submit']);
  const created = await fetch(`${base}/kinesiology-evolutions`, { method: 'POST', headers: headers(author), body: JSON.stringify(draftRequest) });
  assert.equal(created.status, 201, await created.clone().text());
  const draft = await created.json();
  const submitted = await fetch(`${base}/kinesiology-evolutions/${draft.id}/submissions`, { method: 'POST', headers: headers(author), body: '{}' });
  assert.equal(submitted.status, 201, await submitted.clone().text());
  return { id: draft.id, submitted: await submitted.json() };
}

test('an odontology-only student gets the stranger response for detail and history, and an empty list', async () => {
  const pool = evolutionSyntheticPool();
  addOdontologyStudent(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const { id } = await createSubmitted(base, tokens);
    const detailPath = `/kinesiology-evolutions/${id}`;
    const odontology = await signed(tokens, odontologyStudent);
    const strangerDetail = await read(base, await signed(tokens, stranger), detailPath);
    assert.deepEqual({ status: strangerDetail.status, body: await strangerDetail.json() }, { status: 404, body: notFound });
    const detail = await read(base, odontology, detailPath);
    assert.deepEqual({ status: detail.status, body: await detail.json() }, { status: 404, body: notFound });
    const history = await read(base, odontology, `${detailPath}/submissions`);
    assert.deepEqual({ status: history.status, body: await history.json() }, { status: 404, body: notFound });
    const listing = await read(base, odontology, `/kinesiology-evolutions?patient_id=${evolutionPatient}`);
    assert.deepEqual({ status: listing.status, body: await listing.json() }, { status: 200, body: { items: [] } });
  });
});

test('an odontology-only teacher gets the stranger response for detail and an empty list', async () => {
  const pool = evolutionSyntheticPool();
  addOdontologyStudent(pool);
  addOdontologyTeacher(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const { id } = await createSubmitted(base, tokens);
    const teacher = await signed(tokens, odontologyTeacher, 'teacher', ['kinesiology-evolutions:read']);
    const detail = await read(base, teacher, `/kinesiology-evolutions/${id}`);
    assert.deepEqual({ status: detail.status, body: await detail.json() }, { status: 404, body: notFound });
    const listing = await read(base, teacher, `/kinesiology-evolutions?patient_id=${evolutionPatient}`);
    assert.deepEqual({ status: listing.status, body: await listing.json() }, { status: 200, body: { items: [] } });
  });
});

test('a kinesiology student from another kinesiology subject still reads the submitted snapshot', async () => {
  const pool = evolutionSyntheticPool();
  addKinesiologyPeer(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const { id, submitted } = await createSubmitted(base, tokens);
    const peer = await signed(tokens, kinesiologyPeer);
    const detail = await read(base, peer, `/kinesiology-evolutions/${id}`);
    assert.equal(detail.status, 200);
    const projected = await detail.json();
    assert.deepEqual(projected.content, submitted.content);
    assert.equal(projected.status, 'submitted');
    const listing = await read(base, peer, `/kinesiology-evolutions?patient_id=${evolutionPatient}`);
    assert.equal((await listing.json()).items.length, 1);
    const history = await read(base, peer, `/kinesiology-evolutions/${id}/submissions`);
    assert.equal(history.status, 200);
    assert.equal((await history.json()).items.length, 1);
    const crossReads = pool.state.queries.filter(query => query.sql.includes('latest.id IS NOT NULL AND (EXISTS'));
    assert.equal(crossReads.length > 0, true);
    for (const query of crossReads) assert.equal(query.sql.includes(SAME_CAREER_JOIN), true, query.sql);
  });
});

test('an odontology student cannot create a kinesiology evolution in the odontology context', async () => {
  const pool = evolutionSyntheticPool();
  addOdontologyStudent(pool);
  await withEvolutionServer(pool, async (base, tokens) => {
    const response = await fetch(`${base}/kinesiology-evolutions`, { method: 'POST', headers: headers(await signed(tokens, odontologyStudent)),
      body: JSON.stringify({ ...draftRequest, subject_id: odontologySubject, academic_group_id: odontologyGroup }) });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: 'an active student context is required' } });
  });
  assert.equal(pool.state.evolutions.length, 0);
});
