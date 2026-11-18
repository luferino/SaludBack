import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createHygienePreventiveDraftRouter } from '../../src/modules/hygiene-preventive-drafts/index.ts';
import { PgHygienePreventiveDraftRepository } from '../../src/modules/hygiene-preventive-drafts/infrastructure/pg-hygiene-preventive-draft.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { ConflictError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';

const user = '10000000-0000-4000-8000-000000000001';
const patient = '10000000-0000-4000-8000-000000000002';
const subject = '10000000-0000-4000-8000-000000000003';
const group = '10000000-0000-4000-8000-000000000004';
const period = '10000000-0000-4000-8000-000000000005';
const headers = { 'content-type': 'application/json', 'x-role': 'estudiante',
  'x-permissions': 'hygiene-preventive-drafts:read,hygiene-preventive-drafts:write' };
const input = { patient_id: patient, subject_id: subject, academic_group_id: group };
const row = (content = {}) => ({ id: '1', clinical_record_id: '10', patient_id: patient,
  author_id: user, origin_student_habilitation_id: period, origin_subject_id: subject,
  origin_group_id: group, content, status: 'draft', version: '1',
  created_at: '2026-11-18T10:00:00.000Z', updated_at: '2026-11-18T10:00:00.000Z' });

async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: user, role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/hygiene-preventive-drafts', createHygienePreventiveDraftRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/hygiene-preventive-drafts`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, body, requestHeaders = headers) => fetch(base, {
  method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
});
// Every rejected body must answer the same exact 400 and must never reach the repository.
async function assertRejected(base, body, message, calls) {
  const response = await post(base, body);
  assert.equal(response.status, 400, message);
  assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
  assert.equal(calls.count, 0, `repository must not be reached for: ${message}`);
}
const countingRepository = (calls, extra = {}) => ({
  async create() { calls.count++; }, async get() { calls.count++; },
  async list() { calls.count++; }, async edit() { calls.count++; }, ...extra,
});

const FDI_PERMANENT = [...[1, 2, 3, 4].flatMap(q => Array.from({ length: 8 }, (_, i) => `${q}${i + 1}`))];
const FDI_DECIDUOUS = [...[5, 6, 7, 8].flatMap(q => Array.from({ length: 5 }, (_, i) => `${q}${i + 1}`))];

test('S1/S4: medical history keeps null, false and omitted distinct and preserves specify text on every Sí answer', async () => {
  const saved = [];
  const repository = {
    async create(value, actor) { assert.deepEqual(actor, { id: user, role: 'estudiante' });
      const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
    async get(id) { return saved.find(item => item.id === id); },
  };
  const full = {
    medical_history: {
      taking_medication: true, taking_medication_detail: 'Enalapril 10 mg',
      allergy_local_anesthetic: false, allergy_penicillin: null,
      allergy_other_medication: true, allergy_other_medication_detail: 'Aspirina',
      dental_treatment_problem: false, dental_treatment_problem_detail: null,
      cardiovascular_disease: true, cardiovascular_disease_detail: 'Hipertensión arterial',
      treating_physician: 'Dra. Ejemplo', diabetes: false, diabetes_detail: null,
      hypertension: true, renal_disease: null, tuberculosis: false, venereal_disease: false,
      blood_disease: false, other_disease: true, other_disease_detail: 'Asma', pregnant: false,
      observations: 'Sin observaciones adicionales',
    },
  };
  await serve(repository, async base => {
    for (const content of [{}, { medical_history: {} }, { medical_history: { diabetes: null } }, full]) {
      const response = await post(base, { ...input, content });
      assert.equal(response.status, 201);
      const created = await response.json();
      assert.deepEqual(created.content, content);
      const read = await fetch(`${base}/${created.id}`, { headers });
      assert.equal(read.status, 200); assert.deepEqual(await read.json(), created);
    }
    assert.equal(Object.hasOwn(saved[0].content, 'medical_history'), false, 'omitted section stays omitted');
    assert.deepEqual(saved[1].content, { medical_history: {} }, 'empty section is not expanded');
    assert.equal(saved[2].content.medical_history.diabetes, null, 'null means unanswered');
    assert.equal(saved[3].content.medical_history.pregnant, false, 'false means answered No');
  });
});

test('S4: medical history rejects non-boolean answers, invalid text and Oral Surgery fields with exact messages', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const [content, message] of [
      [{ medical_history: { diabetes: 'No' } }, 'medical_history.diabetes must be boolean or null'],
      [{ medical_history: { pregnant: 0 } }, 'medical_history.pregnant must be boolean or null'],
      [{ medical_history: { taking_medication_detail: 'x'.repeat(4001) } },
        'medical_history.taking_medication_detail must be text of at most 4000 characters without NUL, or null'],
      [{ medical_history: { observations: '\u{1F600}'.repeat(4001) } },
        'medical_history.observations must be text of at most 4000 characters without NUL, or null'],
      [{ medical_history: { other_disease_detail: 'before\u0000after' } },
        'medical_history.other_disease_detail must be text of at most 4000 characters without NUL, or null'],
      // A lone UTF-16 surrogate cannot be stored as PostgreSQL JSON text.
      [{ medical_history: { observations: 'broken \uD800 text' } },
        'medical_history.observations must be text of at most 4000 characters without NUL, or null'],
      [{ medical_history: { treating_physician: 7 } },
        'medical_history.treating_physician must be text of at most 4000 characters without NUL, or null'],
      [{ medical_history: { hospitalized: true } }, 'unknown content field: medical_history.hospitalized'],
      [{ medical_history: { medication: 'Example' } }, 'unknown content field: medical_history.medication'],
      [{ medical_history: [] }, 'medical_history must be an object'],
    ]) await assertRejected(base, { ...input, content }, message, calls);
  });
  assert.equal(calls.count, 0);
});

test('S1/S6: content exposes only odontogram, indices, plaque and medical history; no procedure, consent or personal-data fields', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const section of ['plaque_indices', 'procedures', 'procedure_log', 'consent', 'informed_consent',
      'marital_status', 'civil_status', 'medical_insurance', 'personal_data', 'teacher_signature']) {
      await assertRejected(base, { ...input, content: { [section]: {} } }, `unknown content section: ${section}`, calls);
    }
  });
  assert.equal(calls.count, 0);
});

test('S2: every permanent and deciduous FDI code is accepted; any other tooth key is rejected before the repository', async () => {
  const saved = [];
  const repository = {
    async create(value) { const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
  };
  const everyTooth = Object.fromEntries([...FDI_PERMANENT, ...FDI_DECIDUOUS].map(code => [code, { state: 'present' }]));
  assert.equal(FDI_PERMANENT.length, 32); assert.equal(FDI_DECIDUOUS.length, 20);
  await serve(repository, async base => {
    const response = await post(base, { ...input, content: { odontogram: everyTooth } });
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys((await response.json()).content.odontogram).sort(), Object.keys(everyTooth).sort());
  });
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const code of ['10', '19', '29', '39', '49', '56', '59', '66', '76', '86', '00', '9', '111', '1a', '18 ']) {
      await assertRejected(base, { ...input, content: { odontogram: { [code]: { state: 'present' } } } },
        `odontogram.${code} is not a valid FDI tooth code`, calls);
    }
  });
  assert.equal(calls.count, 0);
});

test('S2: a recorded tooth requires state from the closed set and only state and surfaces keys', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    const stateMessage = 'odontogram.11.state must be present, absent or to_extract';
    for (const [tooth, message] of [
      [{}, stateMessage],
      [{ surfaces: {} }, stateMessage],
      [{ state: 'healthy' }, stateMessage],
      [{ state: null }, stateMessage],
      [{ state: 'present', notes: 'x' }, 'unknown content field: odontogram.11.notes'],
      ['present', 'odontogram.11 must be an object'],
      [null, 'odontogram.11 must be an object'],
    ]) await assertRejected(base, { ...input, content: { odontogram: { 11: tooth } } }, message, calls);
  });
  assert.equal(calls.count, 0);
});

test('S2: surfaces accept only the five faces, and each face is a non-empty unique array of caries or filled', async () => {
  const saved = [];
  const repository = {
    async create(value) { const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
  };
  await serve(repository, async base => {
    const response = await post(base, { ...input, content: { odontogram: { 36: { state: 'present', surfaces: {
      occlusal: ['caries'], mesial: ['filled'], distal: ['caries', 'filled'], vestibular: ['caries'], lingual: ['filled'],
    } } } } });
    assert.equal(response.status, 201);
    assert.deepEqual(saved[0].content.odontogram[36].surfaces.distal, ['caries', 'filled'], 'both values allowed = secondary caries');
  });
  const calls = { count: 0 };
  const surfaceMessage = code => `odontogram.11.surfaces.${code} must be a non-empty array of unique caries or filled values`;
  await serve(countingRepository(calls), async base => {
    for (const [surfaces, message] of [
      [{ center: ['caries'] }, 'unknown content field: odontogram.11.surfaces.center'],
      [{ palatal: ['caries'] }, 'unknown content field: odontogram.11.surfaces.palatal'],
      [{ occlusal: [] }, surfaceMessage('occlusal')],
      [{ occlusal: null }, surfaceMessage('occlusal')],
      [{ occlusal: 'caries' }, surfaceMessage('occlusal')],
      [{ mesial: ['fractured'] }, surfaceMessage('mesial')],
      [{ distal: ['caries', 'caries'] }, surfaceMessage('distal')],
      [null, 'odontogram.11.surfaces must be an object'],
    ]) await assertRejected(base, { ...input, content: { odontogram: { 11: { state: 'present', surfaces } } } }, message, calls);
  });
  assert.equal(calls.count, 0);
});

test('S2: an absent tooth cannot carry any marked surface, while to_extract and empty surface objects are allowed', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    await assertRejected(base, { ...input, content: { odontogram: { 16: { state: 'absent', surfaces: { occlusal: ['caries'] } } } } },
      'odontogram.16 is absent and cannot have marked surfaces', calls);
  });
  assert.equal(calls.count, 0);
  const saved = [];
  const repository = {
    async create(value) { const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
  };
  await serve(repository, async base => {
    for (const content of [
      { odontogram: { 16: { state: 'absent', surfaces: {} } } },
      { odontogram: { 17: { state: 'to_extract', surfaces: { occlusal: ['caries'] } } } },
    ]) assert.equal((await post(base, { ...input, content })).status, 201);
  });
  assert.equal(saved.length, 2);
});

test('S2: omitted teeth stay unrecorded in readback and are never filled in as healthy', async () => {
  const saved = [];
  const repository = {
    async create(value) { const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
    async get(id) { return saved.find(item => item.id === id); },
  };
  await serve(repository, async base => {
    const response = await post(base, { ...input, content: { odontogram: { 11: { state: 'present' } } } });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.deepEqual(Object.keys(created.content.odontogram), ['11']);
    const read = await (await fetch(`${base}/${created.id}`, { headers })).json();
    assert.deepEqual(read.content, { odontogram: { 11: { state: 'present' } } });
    assert.equal(Object.hasOwn(read.content.odontogram, '12'), false);
    assert.equal(Object.hasOwn(read.content.odontogram, '21'), false);
  });
});

test('S2: odontogram shape is an object whose surfaces are never null', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    await assertRejected(base, { ...input, content: { odontogram: [] } }, 'odontogram must be an object', calls);
    await assertRejected(base, { ...input, content: { odontogram: null } }, 'odontogram must be an object', calls);
  });
  assert.equal(calls.count, 0);
});

test('S3: index totals are capped (ceo-d 20, CPO-D 32, CPO first molars 4) and the server returns each loaded total', async () => {
  const saved = [];
  const repository = {
    async create(value) { const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
  };
  await serve(repository, async base => {
    const response = await post(base, { ...input, content: { indices: {
      ceo_d: { c: 10, e: 5, o: 5 }, cpo_d: { c: 16, p: 8, o: 8 }, cpo_first_molars: { c: 2, p: 1, o: 1 },
    } } });
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).content.indices, {
      ceo_d: { c: 10, e: 5, o: 5, total: 20 }, cpo_d: { c: 16, p: 8, o: 8, total: 32 },
      cpo_first_molars: { c: 2, p: 1, o: 1, total: 4 },
    });
    assert.deepEqual(saved[0].content.indices.ceo_d, { c: 10, e: 5, o: 5 }, 'stored components carry no client total');
  });
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    for (const [content, message] of [
      [{ indices: { ceo_d: { c: 10, e: 5, o: 6 } } }, 'indices.ceo_d total must be at most 20'],
      [{ indices: { cpo_d: { c: 16, p: 8, o: 9 } } }, 'indices.cpo_d total must be at most 32'],
      [{ indices: { cpo_first_molars: { c: 2, p: 1, o: 2 } } }, 'indices.cpo_first_molars total must be at most 4'],
    ]) await assertRejected(base, { ...input, content }, message, calls);
  });
  assert.equal(calls.count, 0);
});

test('S3: index components are non-negative safe integers and a client-sent total is rejected', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    const component = (index, name) => `indices.${index}.${name} must be a non-negative safe integer`;
    for (const [content, message] of [
      [{ indices: { ceo_d: { c: -1, e: 0, o: 0 } } }, component('ceo_d', 'c')],
      [{ indices: { cpo_d: { c: 1, p: 1.5, o: 0 } } }, component('cpo_d', 'p')],
      [{ indices: { cpo_d: { c: '1', p: 0, o: 0 } } }, component('cpo_d', 'c')],
      [{ indices: { cpo_d: { c: 0, p: 0, o: null } } }, component('cpo_d', 'o')],
      [{ indices: { cpo_d: { c: 9007199254740992, p: 0, o: 0 } } }, component('cpo_d', 'c')],
      [{ indices: { ceo_d: { c: 1, o: 1 } } }, component('ceo_d', 'e')],
      [{ indices: { ceo_d: { c: 1, e: 1, o: 1, total: 3 } } },
        'indices.ceo_d.total is computed by the server and must not be sent'],
      [{ indices: { cpo_first_molars: { c: 0, p: 0, o: 0, total: 0 } } },
        'indices.cpo_first_molars.total is computed by the server and must not be sent'],
      [{ indices: { ceo_d: { c: 1, e: 1, o: 1, notes: 'x' } } }, 'unknown content field: indices.ceo_d.notes'],
      [{ indices: { ceo_d: 5 } }, 'indices.ceo_d must be an object or null'],
      [{ indices: { cpo_d_old: { c: 0, p: 0, o: 0 } } }, 'unknown content field: indices.cpo_d_old'],
      [{ indices: [] }, 'indices must be an object'],
    ]) await assertRejected(base, { ...input, content }, message, calls);
  });
  assert.equal(calls.count, 0);
});

test('S3: an index may stay unloaded as null or omitted, and zero components are valid loaded values', async () => {
  const saved = [];
  const repository = {
    async create(value) { const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
  };
  await serve(repository, async base => {
    const response = await post(base, { ...input, content: { indices: { ceo_d: null, cpo_d: { c: 0, p: 0, o: 0 } } } });
    assert.equal(response.status, 201);
    const content = (await response.json()).content;
    assert.equal(content.indices.ceo_d, null, 'explicit null stays unloaded');
    assert.equal(Object.hasOwn(content.indices, 'cpo_first_molars'), false, 'omitted index stays omitted');
    assert.deepEqual(content.indices.cpo_d, { c: 0, p: 0, o: 0, total: 0 });
  });
});

const LOE_TEETH = ['16', '21', '24', '36', '41', '44'];
const loeTooth = grade => ({ distal: grade, vestibular: grade, mesial: grade, lingual: grade });
const olearyTooth = stained => ({ mesial: stained, distal: stained, vestibular: stained, lingual: stained });
const savingRepository = saved => ({
  async create(value) { const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
  async get(id) { return saved.find(item => item.id === id); },
});

test('Plaque S2/S4: Löe-Silness averages recorded sites, excludes omitted teeth and sites, and classifies by the shown value', async () => {
  const saved = [];
  await serve(savingRepository(saved), async base => {
    for (const [teeth, average, category] of [
      [Object.fromEntries(LOE_TEETH.map(code => [code, loeTooth(0)])), 0, 'low'],
      [Object.fromEntries(LOE_TEETH.map(code => [code, loeTooth(3)])), 3, 'abundant'],
      // 12 sites: sum 6 -> 0.5 is still POCA; sum 7 -> 0.58 is MODERADA.
      [{ 16: loeTooth(1), 21: { distal: 1, vestibular: 1, mesial: 0, lingual: 0 }, 24: loeTooth(0) }, 0.5, 'low'],
      [{ 16: loeTooth(1), 21: { distal: 1, vestibular: 1, mesial: 1, lingual: 0 }, 24: loeTooth(0) }, 0.58, 'moderate'],
      // 4 sites: sum 6 -> 1.5 is MODERADA; sum 7 -> 1.75 is ABUNDANTE (corrected range 1.6-3).
      [{ 36: { distal: 2, vestibular: 2, mesial: 1, lingual: 1 } }, 1.5, 'moderate'],
      [{ 36: { distal: 2, vestibular: 2, mesial: 2, lingual: 1 } }, 1.75, 'abundant'],
      // Omitted sites are not present: 3 recorded sites with sum 1 -> 0.33.
      [{ 41: { distal: 1, vestibular: 0, mesial: 0 }, 44: {} }, 0.33, 'low'],
      [{}, null, null],
    ]) {
      const response = await post(base, { ...input, content: { plaque: { loe_silness: { teeth } } } });
      assert.equal(response.status, 201);
      const created = await response.json();
      assert.deepEqual(created.content.plaque, { loe_silness: { teeth, average, category } });
      const read = await fetch(`${base}/${created.id}`, { headers });
      assert.deepEqual((await read.json()).content.plaque, created.content.plaque, 'reads return the same computed values');
      assert.deepEqual(saved.at(-1).content.plaque, { loe_silness: { teeth } }, 'only the teeth are stored');
    }
  });
});

test('Plaque S3/S4: O\'Leary computes stained over present surfaces of recorded teeth and classifies by the shown percentage', async () => {
  const saved = [];
  await serve(savingRepository(saved), async base => {
    const permanent = Object.fromEntries(FDI_PERMANENT.map(code => [code, olearyTooth(false)]));
    // Ten teeth (40 surfaces) with the first `count` surfaces stained.
    const withStained = count => Object.fromEntries(FDI_PERMANENT.slice(0, 10).map((code, i) => [code, {
      mesial: i * 4 < count, distal: i * 4 + 1 < count, vestibular: i * 4 + 2 < count, lingual: i * 4 + 3 < count }]));
    for (const [teeth, stained, present, percentage, category] of [
      [permanent, 0, 128, 0, 'good'],
      [Object.fromEntries(FDI_DECIDUOUS.map(code => [code, olearyTooth(true)])), 80, 80, 100, 'poor'],
      // 40 surfaces: 12 -> 30% BUENO, 13 -> 32.5% REGULAR, 24 -> 60% REGULAR, 25 -> 62.5% MALO.
      [withStained(12), 12, 40, 30, 'good'],
      [withStained(13), 13, 40, 32.5, 'fair'],
      [withStained(24), 24, 40, 60, 'fair'],
      [withStained(25), 25, 40, 62.5, 'poor'],
      // 3 teeth, 1 stained surface: 8.333 -> 8.3; mixed dentition is accepted.
      [{ 11: { mesial: true, distal: false, vestibular: false, lingual: false }, 55: olearyTooth(false),
        85: olearyTooth(false) }, 1, 12, 8.3, 'good'],
      [{}, 0, 0, null, null],
    ]) {
      const response = await post(base, { ...input, content: { plaque: { oleary: { teeth } } } });
      assert.equal(response.status, 201);
      const created = await response.json();
      assert.deepEqual(created.content.plaque, { oleary: { teeth, stained_surfaces: stained, present_surfaces: present,
        percentage, category } });
      const read = await fetch(`${base}/${created.id}`, { headers });
      assert.deepEqual((await read.json()).content.plaque, created.content.plaque, 'reads return the same computed values');
      assert.deepEqual(saved.at(-1).content.plaque, { oleary: { teeth } }, 'only the teeth are stored');
    }
  });
});

test('Plaque S4: a plaque section may be null or omitted and plaque coexists with the other sections', async () => {
  const saved = [];
  await serve(savingRepository(saved), async base => {
    for (const plaque of [{}, { loe_silness: null }, { oleary: null, loe_silness: { teeth: { 16: loeTooth(2) } } }]) {
      const content = { odontogram: { 16: { state: 'present' } }, indices: { cpo_d: { c: 1, p: 0, o: 0 } }, plaque };
      const response = await post(base, { ...input, content });
      assert.equal(response.status, 201);
      const body = (await response.json()).content;
      assert.deepEqual(body.odontogram, content.odontogram);
      assert.deepEqual(body.indices, { cpo_d: { c: 1, p: 0, o: 0, total: 1 } });
      assert.deepEqual(saved.at(-1).content, content, 'stored content keeps null and omitted sections as sent');
    }
    assert.deepEqual(saved[0].content.plaque, {});
    assert.equal(saved[1].content.plaque.loe_silness, null);
    assert.equal(Object.hasOwn(saved[1].content.plaque, 'oleary'), false, 'omitted section stays omitted');
    assert.equal(saved[2].content.plaque.oleary, null, 'explicit null stays unloaded');
  });
});

test('Plaque S2/S3/S4: invalid plaque input is rejected with exact messages before the repository', async () => {
  const calls = { count: 0 };
  await serve(countingRepository(calls), async base => {
    const computed = (section, key) => `plaque.${section}.${key} is computed by the server and must not be sent`;
    const grade = (code, site) => `plaque.loe_silness.teeth.${code}.${site} must be an integer grade from 0 to 3`;
    for (const [plaque, message] of [
      [[], 'plaque must be an object'],
      [{ silness: null }, 'unknown content field: plaque.silness'],
      [{ loe_silness: 2 }, 'plaque.loe_silness must be an object or null'],
      [{ oleary: [] }, 'plaque.oleary must be an object or null'],
      [{ loe_silness: {} }, 'plaque.loe_silness.teeth must be an object'],
      [{ oleary: { teeth: [] } }, 'plaque.oleary.teeth must be an object'],
      [{ loe_silness: { teeth: {}, average: 0 } }, computed('loe_silness', 'average')],
      [{ loe_silness: { teeth: {}, category: 'low' } }, computed('loe_silness', 'category')],
      [{ oleary: { teeth: {}, percentage: 0 } }, computed('oleary', 'percentage')],
      [{ oleary: { teeth: {}, category: 'good' } }, computed('oleary', 'category')],
      [{ oleary: { teeth: {}, stained_surfaces: 0 } }, computed('oleary', 'stained_surfaces')],
      [{ oleary: { teeth: {}, present_surfaces: 0 } }, computed('oleary', 'present_surfaces')],
      [{ loe_silness: { teeth: {}, notes: 'x' } }, 'unknown content field: plaque.loe_silness.notes'],
      [{ loe_silness: { teeth: { 11: loeTooth(0) } } }, 'plaque.loe_silness.teeth.11 must be one of 16, 21, 24, 36, 41, 44'],
      [{ loe_silness: { teeth: { 16: null } } }, 'plaque.loe_silness.teeth.16 must be an object'],
      [{ loe_silness: { teeth: { 16: { occlusal: 0 } } } }, 'unknown content field: plaque.loe_silness.teeth.16.occlusal'],
      [{ loe_silness: { teeth: { 16: { distal: 4 } } } }, grade(16, 'distal')],
      [{ loe_silness: { teeth: { 21: { mesial: -1 } } } }, grade(21, 'mesial')],
      [{ loe_silness: { teeth: { 24: { lingual: 1.5 } } } }, grade(24, 'lingual')],
      [{ loe_silness: { teeth: { 36: { vestibular: '2' } } } }, grade(36, 'vestibular')],
      [{ loe_silness: { teeth: { 44: { vestibular: null } } } }, grade(44, 'vestibular')],
      [{ oleary: { teeth: { 19: olearyTooth(false) } } }, 'plaque.oleary.teeth.19 is not a valid FDI tooth code'],
      [{ oleary: { teeth: { 86: olearyTooth(false) } } }, 'plaque.oleary.teeth.86 is not a valid FDI tooth code'],
      [{ oleary: { teeth: { 11: true } } }, 'plaque.oleary.teeth.11 must be an object'],
      [{ oleary: { teeth: { 11: { ...olearyTooth(false), occlusal: true } } } },
        'unknown content field: plaque.oleary.teeth.11.occlusal'],
      [{ oleary: { teeth: { 11: { mesial: true, distal: false, vestibular: false } } } },
        'plaque.oleary.teeth.11.lingual must be boolean'],
      [{ oleary: { teeth: { 75: { ...olearyTooth(false), mesial: 1 } } } }, 'plaque.oleary.teeth.75.mesial must be boolean'],
      [{ oleary: { teeth: { 75: { ...olearyTooth(false), distal: null } } } }, 'plaque.oleary.teeth.75.distal must be boolean'],
    ]) await assertRejected(base, { ...input, content: { plaque } }, message, calls);
  });
  assert.equal(calls.count, 0);
});

test('Plaque S4: PATCH validates plaque the same way and returns server-computed values', async () => {
  const calls = { count: 0 };
  const edited = [];
  const repository = { ...countingRepository(calls),
    async edit(id, version, content) { edited.push(content); return { ...row(content), id, version: '2' }; } };
  await serve(repository, async base => {
    const patch = content => fetch(`${base}/1`, { method: 'PATCH', headers,
      body: JSON.stringify({ expected_version: '1', content }) });
    const rejected = await patch({ plaque: { oleary: { teeth: {}, percentage: 10 } } });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: { code: 'BAD_REQUEST',
      message: 'plaque.oleary.percentage is computed by the server and must not be sent' } });
    assert.equal(edited.length, 0, 'rejected PATCH must not reach the repository');
    const response = await patch({ plaque: { loe_silness: { teeth: { 16: loeTooth(1) } } } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).content.plaque,
      { loe_silness: { teeth: { 16: loeTooth(1) }, average: 1, category: 'moderate' } });
    assert.deepEqual(edited, [{ plaque: { loe_silness: { teeth: { 16: loeTooth(1) } } } }]);
  });
});

test('S5: access requires the exact draft permission and role; oral surgery permissions never grant hygiene access', async () => {
  let calls = 0;
  const repository = { async create() { calls++; }, async get() { calls++; },
    async list() { calls++; }, async edit() { calls++; } };
  await serve(repository, async base => {
    for (const method of ['POST', 'PATCH', 'GET']) {
      for (const [custom, status, code, message] of [
        [{ 'content-type': 'application/json' }, 401, 'UNAUTHORIZED', 'Authentication required'],
        [{ ...headers, 'x-permissions': 'oral-surgery-drafts:read,oral-surgery-drafts:write' }, 403, 'FORBIDDEN',
          `Permission 'hygiene-preventive-drafts:${method === 'GET' ? 'read' : 'write'}' required`],
        [{ ...headers, 'x-permissions': 'unrelated' }, 403, 'FORBIDDEN',
          `Permission 'hygiene-preventive-drafts:${method === 'GET' ? 'read' : 'write'}' required`],
        ...(method === 'GET' ? [[{ ...headers, 'x-role': 'reception' }, 403, 'FORBIDDEN', 'clinical role required']] : []),
        ...(method === 'GET' ? [] : ['teacher', 'admin'].map(role =>
          [{ ...headers, 'x-role': role }, 403, 'FORBIDDEN', 'student author role required']
        )),
      ]) {
        const response = await fetch(method === 'PATCH' ? `${base}/1` : base, {
          method, headers: custom, ...(method === 'GET' ? {} : { body: '{}' }),
        });
        assert.equal(response.status, status, `${method} ${code} ${message}`);
        assert.deepEqual(await response.json(), { error: { code, message } });
      }
    }
  });
  assert.equal(calls, 0);
});

test('S5: unknown IDs and unauthorized reads or edits receive the same 404 body without revealing existence', async () => {
  const repository = {
    async get() { throw new NotFoundError('hygiene preventive draft was not found'); },
    async list() { return []; },
    async edit() { throw new NotFoundError('hygiene preventive draft was not found'); },
    async create() { throw new Error('unexpected create'); },
  };
  await serve(repository, async base => {
    const read = await fetch(`${base}/999`, { headers: { ...headers, 'x-role': 'teacher' } });
    assert.equal(read.status, 404);
    assert.deepEqual(await read.json(), { error: { code: 'NOT_FOUND', message: 'hygiene preventive draft was not found' } });
    const foreign = await fetch(`${base}/1`, { method: 'PATCH', headers, body: JSON.stringify({ expected_version: '1', content: {} }) });
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), { error: { code: 'NOT_FOUND', message: 'hygiene preventive draft was not found' } });
  });
});

test('S5/S6: PATCH requires expected_version, rejects provenance overrides and replaces content with an exact stale-version 409', async () => {
  const calls = { count: 0 };
  let staleAttempts = 0;
  const repository = countingRepository(calls, {
    async edit(id, version) {
      calls.count++;
      if (version !== '1') { staleAttempts++; throw new ConflictError('draft version changed; reload before saving'); }
      return { ...row(), version: '2' };
    },
  });
  await serve(repository, async base => {
    for (const [body, message] of [
      [{ content: {} }, 'expected_version must be a positive BIGINT decimal string'],
      [{ content: {}, expected_version: 1 }, 'expected_version must be a positive BIGINT decimal string'],
      [{ content: {}, expected_version: '0' }, 'expected_version must be a positive BIGINT decimal string'],
      [{ expected_version: '1' }, 'content must be an object'],
      [{ content: {}, expected_version: '1', origin_group_id: group }, 'allowed fields: content, expected_version'],
      [{ content: {}, expected_version: '1', origin_subject_id: subject }, 'allowed fields: content, expected_version'],
    ]) {
      const response = await fetch(`${base}/1`, { method: 'PATCH', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400, message);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message } });
    }
    assert.equal(calls.count, 0, 'rejected PATCH bodies never reach the repository');
    const stale = await fetch(`${base}/1`, { method: 'PATCH', headers, body: JSON.stringify({ expected_version: '7', content: {} }) });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: { code: 'CONFLICT', message: 'draft version changed; reload before saving' } });
    assert.equal(staleAttempts, 1);
  });
});

function fakeDatabase({ inactive = false, assignment = true, conflict = false } = {}) {
  const calls = [], events = [];
  let nextId = 0;
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('FROM students WHERE')) return { rows: [{ id: user }] };
    if (sql.includes('FROM student_academic_habilitations h')) return { rows: inactive ? [] : [{ id: period }] };
    if (sql.includes('FROM patients WHERE')) return { rows: [{ id: patient }] };
    if (sql.includes('FROM patient_assignments a')) return { rows: assignment ? [{ id: '1', student_habilitation_id: period }] : [] };
    if (sql.includes('INSERT INTO clinical_records')) return { rows: [{ id: '10' }] };
    if (sql.includes('INSERT INTO hygiene_preventive_drafts')) return { rows: [{ ...row(JSON.parse(params[6])), id: String(++nextId) }] };
    if (sql.includes('UPDATE hygiene_preventive_drafts')) return { rows: conflict ? [] : [{ ...row(JSON.parse(params[2])), version: '2' }] };
    if (sql.includes('FROM hygiene_preventive_drafts')) return { rows: [row()] };
    throw new Error(`unexpected SQL ${sql}`);
  } };
  const unit = { async withTransaction(run) { events.push('BEGIN'); try {
    const result = await run(db); events.push('COMMIT'); return result;
  } catch (error) { events.push('ROLLBACK'); throw error; } } };
  return { repository: new PgHygienePreventiveDraftRepository(unit, db), calls, events };
}

test('S5: repository creates encounters atomically with an explicit enabled subject, current context and shared history', async () => {
  const { repository, calls, events } = fakeDatabase();
  const actor = { id: user, role: 'estudiante' };
  const value = { patientId: patient, subjectId: subject, groupId: group, content: {} };
  assert.notEqual((await repository.create(value, actor)).id, (await repository.create(value, actor)).id);
  assert.deepEqual(events, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  const periods = calls.find(call => call.sql.includes('FROM student_academic_habilitations h'));
  assert.match(periods.sql, /JOIN hygiene_preventive_subjects link/); assert.match(periods.sql, /c.code = 'odontology'/);
  assert.match(periods.sql, /h.revoked_at IS NULL/); assert.match(periods.sql, /FOR UPDATE OF h/);
  const history = calls.find(call => call.sql.includes('INSERT INTO clinical_records'));
  assert.match(history.sql, /ON CONFLICT \(patient_id\) DO NOTHING/);
  assert.ok(calls.indexOf(periods) < calls.indexOf(history));
  const insert = calls.find(call => call.sql.includes('INSERT INTO hygiene_preventive_drafts'));
  assert.match(insert.sql, /origin_subject_id/); assert.deepEqual(insert.params[4], subject);
});

test('S5/S6: inactive authors or missing assignments cannot write; a restored period restores edit without origin changes', async () => {
  for (const options of [{ inactive: true }, { assignment: false }]) {
    const { repository, calls, events } = fakeDatabase(options);
    await assert.rejects(repository.create({ patientId: patient, subjectId: subject, groupId: group, content: {} },
      { id: user, role: 'estudiante' }), error => [403, 404].includes(error.statusCode));
    assert.equal(calls.some(call => /INSERT|UPDATE hygiene_preventive_drafts/.test(call.sql)), false);
    assert.deepEqual(events, ['BEGIN', 'ROLLBACK']);
  }
  const { repository, calls } = fakeDatabase();
  await repository.edit('1', '1', {}, { id: user, role: 'estudiante' });
  const periods = calls.find(call => call.sql.includes('FROM student_academic_habilitations h'));
  assert.deepEqual(periods.params, [user, subject, group]);
  assert.doesNotMatch(periods.sql, /origin_student_habilitation_id/);
  const edit = calls.find(call => call.sql.includes('UPDATE hygiene_preventive_drafts'));
  assert.match(edit.sql, /version = version \+ 1/); assert.match(edit.sql, /version = \$2/);
  assert.match(edit.sql, /e.author_id = \$4/);
  assert.doesNotMatch(edit.sql.split('RETURNING')[0], /origin_|clinical_record_id = |patient_id = \$/);
});

test('S3/S5: reads bind the selected role and the live author or teacher origin context; admin reads never enable writes', async () => {
  const { repository, calls } = fakeDatabase();
  for (const role of ['admin', 'teacher', 'estudiante']) await repository.get('1', { id: user, role });
  for (const { sql, params } of calls) {
    assert.match(sql, /\$3 = 'admin'/); assert.match(sql, /\$3 = 'teacher'/);
    assert.match(sql, /e.author_id = \$2/); assert.match(sql, /sp.revoked_at IS NULL/);
    assert.match(sql, /a.ended_at IS NULL/); assert.match(sql, /th.academic_group_id = e.origin_group_id/);
    assert.equal(params[1], user);
  }
  for (const role of ['admin', 'teacher']) await assert.rejects(repository.edit('1', '1', {}, { id: user, role }), { statusCode: 403 });
  const conflict = fakeDatabase({ conflict: true });
  await assert.rejects(conflict.repository.edit('1', '1', {}, { id: user, role: 'estudiante' }), { statusCode: 409 });
  assert.deepEqual(conflict.events, ['BEGIN', 'ROLLBACK']);
});

test('S5: list filters by patient, subject and group only, and binds every filter as a parameter', async () => {
  const { repository, calls } = fakeDatabase();
  await repository.list({ patientId: patient, subjectId: subject, groupId: group, limit: 50, offset: 0 }, { id: user, role: 'teacher' });
  const list = calls.find(call => /ORDER BY e.id DESC/.test(call.sql));
  assert.match(list.sql, /e.patient_id = \$1/); assert.match(list.sql, /e.origin_subject_id = \$4/);
  assert.match(list.sql, /e.origin_group_id = \$5/); assert.match(list.sql, /LIMIT \$6 OFFSET \$7/);
  assert.doesNotMatch(list.sql, /created_at >=|date_from|date_to/);
  assert.deepEqual(list.params, [patient, user, 'teacher', subject, group, 50, 0]);
});

test('S1/S5: migrations 056/057 reuse earlier keys, never re-create an earlier constraint, index, function or trigger name', () => {
  // Constraints, indexes, functions and triggers share namespaces; comments are ignored.
  const names = file => [...readFileSync(`src/db/migrations/${file}`, 'utf8').replace(/--.*$/gm, '')
    .matchAll(/(?:(?<!DROP\s+)\bCONSTRAINT|\bCREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?|\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER))\s+(\w+)/gi)]
    .map(match => match[1].toLowerCase());
  const migrations = readdirSync('src/db/migrations').filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  const earlier = new Set(migrations.filter(name => name < '056').flatMap(names));
  for (const file of migrations.filter(name => name >= '056')) {
    for (const name of names(file)) assert.equal(earlier.has(name), false, `${file} re-creates ${name}`);
  }
  const schema = readFileSync('src/db/migrations/056_create_hygiene_preventive_drafts.sql', 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(schema, /student_habilitations_id_context_unique/, 'reuses the 040 key without re-creating it');
  assert.doesNotMatch(schema, /clinical_records_id_patient_unique/, 'reuses the 031 key without re-creating it');
});

test('S1/S5: schema pins draft-only rows to hygiene subjects, shared history and immutable provenance', () => {
  const schema = readFileSync('src/db/migrations/056_create_hygiene_preventive_drafts.sql', 'utf8');
  assert.match(schema, /CREATE TABLE hygiene_preventive_drafts/);
  assert.match(schema, /CHECK \(status = 'draft'\)/);
  assert.match(schema, /jsonb_typeof\(content\) = 'object'/);
  assert.match(schema, /origin_subject_id UUID NOT NULL REFERENCES hygiene_preventive_subjects\(subject_id\)/);
  assert.match(schema, /FOREIGN KEY \(clinical_record_id, patient_id\) REFERENCES clinical_records\(id, patient_id\)/);
  assert.match(schema, /FOREIGN KEY \(origin_student_habilitation_id, origin_subject_id, origin_group_id\)/);
  assert.match(schema, /BEFORE UPDATE ON hygiene_preventive_drafts/);
  assert.match(schema, /NEW.origin_student_habilitation_id/);
  assert.match(schema, /hygiene preventive draft origin is immutable/);
});

test('S5: permission seed 057 grants students read and write, teachers and admins read only', () => {
  const seed = readFileSync('src/db/migrations/057_seed_hygiene_preventive_draft_permissions.sql', 'utf8');
  assert.match(seed, /\('hygiene-preventive-drafts:read', true\)/);
  assert.match(seed, /\('hygiene-preventive-drafts:write', true\)/);
  assert.match(seed, /\('estudiante', 'hygiene-preventive-drafts:read'\)/);
  assert.match(seed, /\('estudiante', 'hygiene-preventive-drafts:write'\)/);
  assert.match(seed, /\('teacher', 'hygiene-preventive-drafts:read'\)/);
  assert.match(seed, /\('admin', 'hygiene-preventive-drafts:read'\)/);
  assert.doesNotMatch(seed, /\('(?:admin|teacher)', 'hygiene-preventive-drafts:write'\)/);
});
