import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDb } from '../integration/helpers/clean-db.js';

test('cleanDb truncates clinical history first, before drafts, and replays close permission', async () => {
  const calls = [];
  await cleanDb({ async query(text) {
    calls.push(text);
    return { rows: [] };
  } });
  // The correction FK cycle lives inside the truncated closure, so no link UPDATE or column privilege probe precedes it.
  assert.equal(calls.some(sql => /^UPDATE\b|has_column_privilege/.test(sql)), false);
  const historyTruncate = calls.findIndex(sql => sql.startsWith('TRUNCATE ') && sql.includes('oral_surgery_practical_evaluations'));
  const draftDelete = calls.indexOf('DELETE FROM oral_surgery_drafts');
  assert.equal(historyTruncate, 0);
  assert.ok(historyTruncate < draftDelete);
  for (const table of ['kinesiology_evaluations', 'kinesiology_evaluation_submissions', 'oral_surgery_practical_evaluations', 'oral_surgery_operative_reports', 'oral_surgery_authorizations', 'oral_surgery_consent_declarations']) {
    assert.match(calls[historyTruncate], new RegExp(`\\b${table}\\b`), table);
  }
  assert.ok(calls.indexOf('TRUNCATE role_permissions, permissions RESTART IDENTITY') > draftDelete);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:authorize')), /oral-surgery-drafts:authorize/);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:close')), /\('teacher', 'oral-surgery-drafts:close'\)/);
  assert.match(calls.find(sql => sql.includes('oral-surgery-drafts:grade')), /\('teacher', 'oral-surgery-drafts:grade'\)/);
  assert.equal(calls.length, 43);
});
