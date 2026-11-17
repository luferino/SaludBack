import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb checks privileges, truncates clinical history before drafts, and replays close permission', async () => {
  const calls = [];
  await cleanDb({ async query(text) {
    calls.push(text);
    return text.includes('has_column_privilege') ? { rows: [{ allowed: true }] } : { rows: [] };
  } });
  assert.equal(calls[0], "SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed");
  assert.equal(calls[1], 'UPDATE kinesiology_evaluations SET correction_from_submission_id = NULL WHERE correction_from_submission_id IS NOT NULL');
  const historyTruncate = calls.findIndex(sql => sql.startsWith('TRUNCATE ') && sql.includes('oral_surgery_practical_evaluations'));
  const draftDelete = calls.indexOf('DELETE FROM oral_surgery_drafts');
  assert.ok(historyTruncate > 1 && historyTruncate < draftDelete);
  for (const table of ['oral_surgery_practical_evaluations', 'oral_surgery_operative_reports', 'oral_surgery_authorizations', 'oral_surgery_consent_declarations']) {
    assert.match(calls[historyTruncate], new RegExp(`\\b${table}\\b`), table);
  }
  assert.ok(calls.indexOf('TRUNCATE role_permissions, permissions RESTART IDENTITY') > draftDelete);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:authorize')), /oral-surgery-drafts:authorize/);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:close')), /\('teacher', 'oral-surgery-drafts:close'\)/);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:grade')), /\('teacher', 'oral-surgery-drafts:grade'\)/);
  assert.equal(calls.length, 45);
});

test('cleanDb fails closed on missing correction-link UPDATE privilege before any cleanup mutation', async () => {
  const calls = [];
  await assert.rejects(cleanDb({ async query(text) {
    calls.push(text);
    return { rows: [{ allowed: false }] };
  } }), /UPDATE privilege on public\.kinesiology_evaluations\.correction_from_submission_id/);
  assert.deepEqual(calls, ["SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed"]);
  assert.equal(calls.some(sql => /^(UPDATE|DELETE|TRUNCATE)\b|INSERT INTO/.test(sql)), false);
});
