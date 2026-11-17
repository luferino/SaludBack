import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb checks privileges, deletes operative reports before their dependencies, and replays close permission', async () => {
  const calls = [];
  await cleanDb({ async query(text) {
    calls.push(text);
    return text.includes('has_column_privilege') ? { rows: [{ allowed: true }] } : { rows: [] };
  } });
  assert.equal(calls[0], "SELECT has_column_privilege(current_user, 'public.kinesiology_evaluations', 'correction_from_submission_id', 'UPDATE') AS allowed");
  assert.equal(calls[1], 'UPDATE kinesiology_evaluations SET correction_from_submission_id = NULL WHERE correction_from_submission_id IS NOT NULL');
  const practicalDelete = calls.indexOf('DELETE FROM oral_surgery_practical_evaluations');
  const reportDelete = calls.indexOf('DELETE FROM oral_surgery_operative_reports');
  const authorizationDelete = calls.indexOf('DELETE FROM oral_surgery_authorizations');
  const draftDelete = calls.indexOf('DELETE FROM oral_surgery_drafts');
  assert.ok(practicalDelete > 1 && practicalDelete < reportDelete);
  assert.ok(reportDelete > 1 && reportDelete < authorizationDelete && authorizationDelete < draftDelete);
  assert.ok(calls.indexOf('TRUNCATE role_permissions, permissions RESTART IDENTITY') > draftDelete);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:authorize')), /oral-surgery-drafts:authorize/);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:close')), /\('teacher', 'oral-surgery-drafts:close'\)/);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:grade')), /\('teacher', 'oral-surgery-drafts:grade'\)/);
  assert.equal(calls.length, 60);
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
