import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTreatmentContent } from '../../src/modules/endodontics-drafts/domain/treatment-content.ts';

const bad = (value) => assert.throws(() => validateTreatmentContent(value), { statusCode: 400, code: 'BAD_REQUEST' });
const canal = (overrides = {}) => ({
  tooth: '16', canal: 'MV', reference_point: 'cúspide', real_tooth_length: '21', real_working_length: '20',
  apical_patency_instrument: '#10', initial_instrument: '#15', memory_instrument: '#25', final_instrument: '#30',
  main_gutta_percha: '30/.04', accessory_gutta_percha: '2 x 25/.02', obturation_cut: { option: 'apex_mm', apex_mm: '1' },
  ...overrides,
});
const access = (row) => ({ high_speed_bur: '1', low_speed_bur: null, rotary_file: null, manual_file: '10/15', other: null, ...row });
const full = {
  treated_teeth: ['16', '17', '18'],
  diagnosis: 'texto libre de diagnóstico',
  treatment_plan: 'texto libre de plan',
  session_count: 2,
  access_procedures: {
    access_cavity_preparation: access(), canal_entry_preparation: access({ manual_file: null }),
    anticurvature_wear: access({ high_speed_bur: null }), other: { other: 'texto' },
  },
  technique_checklists: {
    instrumentation_technique: { selected: ['manual', 'laser'], other_text: null },
    rotary_system: { selected: ['Protaper', 'Endo IZE'], other_text: 'otro sistema' },
    modality: { selected: ['crown_down'], other_text: null },
    obturation_technique: { selected: ['lateral_condensation'], other_text: null },
    irrigants: { selected: ['sodium_hypochlorite', 'edta'], other_text: null, percentages: { sodium_hypochlorite: '2.5 %', edta: '17 %' } },
    intracanal_medication: { selected: ['calcium_hydroxide'], other_text: null },
    sealer: { selected: ['mta'], other_text: null },
  },
  canal_measurements: [canal(), canal({ canal: 'DB', obturation_cut: { option: 'canal_entry', apex_mm: null } })],
  accidents: null,
  observations: 'sin observaciones',
};

test('S1/S2: the full printed report shape round-trips unchanged; incomplete saves are valid', () => {
  assert.deepEqual(validateTreatmentContent(full), full);
  assert.deepEqual(validateTreatmentContent({}), {});
  assert.deepEqual(validateTreatmentContent({ treated_teeth: [] }), { treated_teeth: [] });
});

test('S2: treated teeth are a text list of at most eight entries and are never matched to the draft', () => {
  assert.deepEqual(validateTreatmentContent({ treated_teeth: Array.from({ length: 8 }, (_, i) => `${i + 11}`) }).treated_teeth.length, 8);
  bad({ treated_teeth: Array.from({ length: 9 }, (_, i) => `${i + 11}`) });
  bad({ treated_teeth: ' 16' });
  bad({ treated_teeth: [16] });
  bad({ treated_teeth: [''] });
  bad({ treated_teeth: [null] });
});

test('S4: session count is an optional non-negative integer with no date fields', () => {
  assert.equal(validateTreatmentContent({ session_count: 0 }).session_count, 0);
  assert.equal(validateTreatmentContent({ session_count: null }).session_count, null);
  for (const value of [-1, 1.5, '2', true, Number.MAX_SAFE_INTEGER + 1]) bad({ session_count: value });
  bad({ session_dates: ['2026-01-01'] });
});

test('S5: canal rows carry every printed column as bounded text and a closed obturation-cut choice', () => {
  bad({ canal_measurements: [canal({ unexpected_column: '1' })] });
  bad({ canal_measurements: [canal({ obturation_cut: { option: 'middle', apex_mm: '1' } })] });
  bad({ canal_measurements: [canal({ obturation_cut: 'canal_entry' })] });
  bad({ canal_measurements: [canal({ real_working_length: 20 })] });
  bad({ canal_measurements: [canal({ canal: 'x\u0000' })] });
  bad({ canal_measurements: Array.from({ length: 65 }, () => canal()) });
  assert.equal(validateTreatmentContent({ canal_measurements: Array.from({ length: 64 }, () => canal()) }).canal_measurements.length, 64);
});

test('S5 boundary: canal rows are capped at 64 (8 teeth x up to 8 canals, a technical bound, not a clinical rule): 64 accepted, 65 rejected', () => {
  assert.equal(validateTreatmentContent({ canal_measurements: Array.from({ length: 64 }, () => canal()) }).canal_measurements.length, 64);
  bad({ canal_measurements: Array.from({ length: 65 }, () => canal()) });
});

test('printed checklists accept only printed options, unique selections, optional other text, and printed percentages', () => {
  bad({ technique_checklists: { modality: { selected: ['unknown_mode'], other_text: null } } });
  bad({ technique_checklists: { modality: { selected: ['crown_down', 'crown_down'], other_text: null } } });
  bad({ technique_checklists: { modality: { selected: [], other_text: null, percentages: { crown_down: '1' } } } });
  bad({ technique_checklists: { irrigants: { selected: [], other_text: null, percentages: { laser: '1' } } } });
  bad({ technique_checklists: { unknown_list: { selected: [], other_text: null } } });
  bad({ technique_checklists: { modality: { selected: [], other_text: 'x'.repeat(4001) } } });
  bad({ technique_checklists: { rotary_system: { selected: ['Protaper'], other_text: '\uD800' } } });
  assert.deepEqual(validateTreatmentContent({ technique_checklists: { rotary_system: { selected: ['Endo IZE'], other_text: null } } })
    .technique_checklists.rotary_system.selected, ['Endo IZE']);
});

test('access procedures are a fixed row and column grid of bounded text', () => {
  bad({ access_procedures: { unknown_row: access() } });
  bad({ access_procedures: { access_cavity_preparation: { unknown_column: 'x' } } });
  bad({ access_procedures: { access_cavity_preparation: { high_speed_bur: 1 } } });
  bad({ access_procedures: { canal_entry_preparation: 'texto' } });
  assert.deepEqual(validateTreatmentContent({ access_procedures: { other: { other: null } } }).access_procedures, { other: { other: null } });
});

test('unknown keys, patient demographics, and header identity fields are rejected', () => {
  for (const key of ['patient_name', 'patient_id', 'fecha', 'profesional', 'email', 'telefono', 'signature', 'tooth_or_region']) {
    bad({ [key]: 'x' });
  }
  bad({ diagnosis: 'ok', extra: null });
  bad({ canal_measurements: [{ ...canal(), patient_name: 'x' }] });
  bad(null); bad([]); bad('texto');
});

test('text is bounded to 4000 code points and rejects NUL and lone surrogates everywhere', () => {
  assert.equal(validateTreatmentContent({ observations: '😀'.repeat(4000) }).observations.length, 8000);
  bad({ observations: 'x'.repeat(4001) });
  bad({ observations: '😀'.repeat(4001) });
  bad({ diagnosis: 'a\u0000b' });
  bad({ treatment_plan: '\uD800' });
  bad({ accidents: 1 });
  bad({ access_procedures: { other: { other: '\uDC00' } } });
});
