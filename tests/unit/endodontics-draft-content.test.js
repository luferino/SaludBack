import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createEndodonticsDraftRouter } from '../../src/modules/endodontics-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const actor = '10000000-0000-4000-8000-000000000001';
const input = { patient_id: '10000000-0000-4000-8000-000000000002', subject_id: '10000000-0000-4000-8000-000000000003', academic_group_id: '10000000-0000-4000-8000-000000000004' };
const studentHeaders = { 'content-type': 'application/json', 'x-role': 'estudiante', 'x-permissions': 'endodontics-drafts:read,endodontics-drafts:write' };
function fakeRepository() {
  const storage = [];
  return { storage,
    async create(value, who) { const row = { ...value, id: String(storage.length + 1), author_id: who.id, status: 'draft', version: '1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }; storage.push(row); return row; },
    async get(id) { return storage.find(row => row.id === id); },
    async list() { return storage; },
    async edit(id, version, content) { const row = storage.find(item => item.id === id); row.content = content; row.version = String(Number(version) + 1); return row; },
  };
}
async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-role']) req.auth = { userId: actor, role: req.headers['x-role'], permissions: String(req.headers['x-permissions'] ?? '').split(',') }; next(); });
  app.use('/endodontics-drafts', createEndodonticsDraftRouter({ repository })); app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/endodontics-drafts`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, content) => fetch(base, { method: 'POST', headers: studentHeaders, body: JSON.stringify({ ...input, content }) });

 test('S4-S8 valid incomplete content persists through public create/read/versioned replacement', async () => {
  const repo = fakeRepository();
  await serve(repo, async base => {
    const incomplete = await post(base, {}); assert.equal(incomplete.status, 201);
    const created = await incomplete.json();
    const full = {
      patient_history: { responsible_physician: 'Clinician', physician_phone: '555-0100', general_health: 'reported well', current_treatment: false, current_treatment_reason: 'none', medication: true, medication_name_reason: 'example medicine', medication_allergy: null, allergy_detail: null, recent_hospitalization: false, hospitalization_reason: 'none', last_medical_exam: 'last year', blood_pressure: '120/80', previous_operation: true, operation_reason: 'patient reported', cardiovascular: false, cardiovascular_detail: null, hematologic: null, hematologic_detail: null, neurologic: false, neurologic_detail: null, respiratory: null, respiratory_detail: null, gastrointestinal: false, gastrointestinal_detail: null, endocrine: null, endocrine_detail: null, urinary: false, urinary_detail: null, musculoskeletal: null, musculoskeletal_detail: null, eye_ear_nose_throat: false, eye_ear_nose_throat_detail: null, social: null, social_detail: null, infectious: false, infectious_detail: null, smoking_years: '3', cigarettes_per_day: '2', alcohol_type: 'none', alcohol_amount_per_day: '0', other_habits: 'none', drugs_type: 'none', drug_dependency: 'not recorded' },
      complaint: { chief_complaint: 'pain', reason_for_treatment: 'reported', prior_anesthesia_reaction: null, treatment_trauma: false, prior_endodontic_treatment: true, dental_trauma: false, pain_location: 'tooth', onset: 'today', provoking_factor: 'cold', relieving_factor: 'none', frequency: 'sometimes', time_since_onset: 'one day', expectations: 'relief' },
      tooth_or_region: '36 or lower-left molar region',
      pain: { intensity: 0, distribution: 'localized', trigger: 'provoked', duration: 'short', pattern: 'intermittent', location: '36', onset: 'today', provoking_factor: 'cold', relieving_factor: 'none', frequency: 'sometimes', time_since_onset: 'one day' },
      examination: { tooth_structure: 'restored', color: 'normal', edema: ['local', 'mucosal'], fistula: ['intraoral'], caries_depth: 'deep', protective_material: true, protective_material_type: 'liner', restorative_material: 'resin', wear: ['erosion', 'attrition'], trauma: null, periodontal_pocket: false, pocket_depth: 'not present', hygiene: 'good', coronal_palpation: false, periapical_palpation: null, coronal_percussion: false, periapical_percussion: true, edema_evolution: 'evolving', vertical_mobility: null, horizontal_mobility: false, atm_pain: null, mouth_opening_pain: false, midline_deviation: null, observations: 'clinical note' },
      vitality: { cold: ['relief', 'stimulus'], heat: ['stimulus'], electric: ['relief'], cavity_test: true, anesthesia_test: false, observations: 'recorded observations' },
      radiography: { chamber: ['normal_wide', 'calcified'], canals: ['narrow', 'internal_resorption'], periapical: ['normal', 'hypercementosis'], notes: 'notes may mention canal MV; no canal-specific measurements' },
      probable_diagnosis: ['reversible_pulpitis_inflammatory', 'probable_cyst', 'probable_granuloma', 'other'],
      diagnosis_other_text: 'student-provided text', proposed_plan: ['pulpotomy', 'retreatment', 'other'], plan_other_text: 'student-provided plan', teacher_observations: 'instructor notes',
    };
    const saved = await post(base, full); assert.equal(saved.status, 201);
    const createdFull = await saved.json(); assert.deepEqual(createdFull.content, full);
    const read = await fetch(`${base}/${createdFull.id}`, { headers: studentHeaders }); assert.equal(read.status, 200); assert.deepEqual((await read.json()).content, full);
    const replacement = { content: { tooth_or_region: null, pain: { intensity: 10 }, teacher_observations: 'follow-up note' }, expected_version: '1' };
    const edited = await fetch(`${base}/${createdFull.id}`, { method: 'PATCH', headers: studentHeaders, body: JSON.stringify(replacement) });
    assert.equal(edited.status, 200); assert.deepEqual((await edited.json()).content, replacement.content);
  });
});

test('S5-S8 invalid field types, vocabularies, copied identity, and unsupported detail reject without changing fake storage', async () => {
  const repo = fakeRepository();
  const invalid = [
    [{ patient_history: { medication: 'false' } }, 'patient_history.medication'],
    [{ patient_history: { cardiovascular: 0 } }, 'patient_history.cardiovascular'],
    [{ patient_history: { previous_operation: 'No' } }, 'patient_history.previous_operation'],
    [{ complaint: { treatment_trauma: 'false' } }, 'complaint.treatment_trauma'],
    [{ examination: { protective_material: 'present' } }, 'examination.protective_material'],
    [{ vitality: { cavity_test: 'absent' } }, 'vitality.cavity_test'],
    [{ complaint: { prior_anesthesia_reaction: 'no' } }, 'complaint.prior_anesthesia_reaction'],
    [{ examination: { tooth_structure: 'healthy' } }, 'examination.tooth_structure'],
    [{ examination: { color: 'white' } }, 'examination.color'],
    [{ examination: { edema: ['local', 'made-up'] } }, 'examination.edema'],
    [{ examination: { hygiene: 'excellent' } }, 'examination.hygiene'],
    [{ pain: { distribution: 'regional' } }, 'pain.distribution'],
    [{ vitality: { cold: ['painful'] } }, 'vitality.cold'],
    [{ radiography: { chamber: ['normal_wide', 'invented'] } }, 'radiography.chamber'],
    [{ radiography: { canals: [{ canal: 'MV', measurement: 2 }], notes: '' } }, 'radiography.canals'],
    [{ tooth_or_region: ['36', '37'] }, 'tooth_or_region'],
    [{ tooth_or_region: 'x'.repeat(4001) }, 'tooth_or_region'],
    [{ pain: { intensity: -1 } }, 'pain.intensity'], [{ pain: { intensity: 11 } }, 'pain.intensity'],
    [{ pain: { intensity: 1.5 } }, 'pain.intensity'], [{ pain: { intensity: '0' } }, 'pain.intensity'],
    [{ probable_diagnosis: ['not-a-diagnosis'] }, 'probable_diagnosis'],
    [{ proposed_plan: ['root_canal_per_tooth'] }, 'proposed_plan'],
    [{ teacher_observations: 22 }, 'teacher_observations'],
    [{ teacher_observations: 'x'.repeat(4001) }, 'teacher_observations'],
    [{ patient_history: { responsible_physician: 'x'.repeat(4001) } }, 'patient_history.responsible_physician'],
    [{ patient_history: { cardiovascular_detail: 'x'.repeat(4001) } }, 'patient_history.cardiovascular_detail'],
    [{ radiography: { notes: 'bad\0text' } }, 'radiography.notes'],
    [{ complaint: { expectations: '\uD800' } }, 'complaint.expectations'],
    [{ teacher_observations: 'bad\0text' }, 'teacher_observations'],
    [{ teacher_observations: '\uD800' }, 'teacher_observations'],
    [{ patient_name: 'demographic copy' }, 'unknown content section'],
    [{ complaint: { undocumented_field: true } }, 'unknown content field'],
  ];
  await serve(repo, async base => {
    for (const [content] of invalid) assert.equal((await post(base, content)).status, 400, JSON.stringify(content));
    assert.equal((await post(base, { pain: {} })).status, 201);
    assert.equal((await post(base, { pain: { intensity: 0 } })).status, 201);
    assert.equal((await post(base, { pain: { intensity: 10 } })).status, 201);
  });
  assert.equal(repo.storage.length, 3, 'only accepted empty/0/10 payloads are stored');
});

test('S6 pain absent remains distinct from a recorded zero; no server severity/category is returned', async () => {
  const repo = fakeRepository();
  await serve(repo, async base => {
    const absent = await post(base, {}); const zero = await post(base, { pain: { intensity: 0 } });
    assert.equal(absent.status, 201); assert.equal(zero.status, 201);
    const absentRow = await absent.json(); const zeroRow = await zero.json();
    assert.equal(Object.hasOwn(absentRow.content, 'pain'), false);
    assert.equal(zeroRow.content.pain.intensity, 0);
    assert.equal(Object.hasOwn(zeroRow.content.pain, 'severity'), false);
    assert.equal(Object.hasOwn(zeroRow.content.pain, 'category'), false);
  });
});
