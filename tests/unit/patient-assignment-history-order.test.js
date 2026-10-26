import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../integration/patient-assignment-lifecycle.test.js', import.meta.url), 'utf8');
const cases = [
  {
    title: 'real PostgreSQL destination withdrawal versus reassignment preserves the serialized winner without partial closure',
    end: '  const end = await request(',
  },
  {
    title: 'real PostgreSQL permits moving an existing assignment out of a withdrawn source into an enabled destination',
    end: '\n});',
  },
];

// Exercise the integration tests' actual stored-history assertions without
// importing their database hooks or replacing production behavior with mocks.
function historyAssertions({ title, end }) {
  const testStart = source.indexOf(`test('${title}'`);
  assert.notEqual(testStart, -1, 'the named integration case must exist');
  const nextTest = source.indexOf('\ntest(', testStart + 1);
  const start = source.indexOf('  const {rows} = await pool.query(', testStart);
  assert.ok(start > testStart && (nextTest === -1 || start < nextTest), 'history query must belong to this case');
  const finish = source.indexOf(end, start);
  assert.ok(finish > start && (nextTest === -1 || finish < nextTest), 'history assertion boundary must belong to this case');
  return new Function('pool', 'assert', 'f', 'created', 'moved', `return (async () => {\n${source.slice(start, finish)}\n})();`);
}

const f = { patient: 'patient-1', teacher: { id: 'teacher-1' } };
const created = { body: { id: '9' } };
const moved = { status: 200, body: { id: '10' } };
const sourceRow = { id: '9', ended_by: f.teacher.id, ended_at: '2026-01-01T00:00:00Z' };
const destinationRow = { id: '10', ended_by: null, ended_at: null };

async function run(check, rows, result = moved) {
  const before = structuredClone(rows);
  let queries = 0;
  const pool = {
    async query(sql, parameters) {
      queries++;
      assert.match(sql, /^SELECT /, 'only the stored-history read may execute');
      assert.deepEqual(parameters, [f.patient]);
      return { rows };
    },
  };
  await check(pool, assert, f, created, result);
  assert.equal(queries, 1);
  assert.deepEqual(rows, before, 'history assertions must not mutate supplied rows');
}

test('new reassignment history assertions use identity, not decimal text ordering', async () => {
  for (const integrationCase of cases) {
    const check = historyAssertions(integrationCase);
    // PostgreSQL ORDER BY the id::text output alias places "10" before "9".
    await run(check, [structuredClone(destinationRow), structuredClone(sourceRow)]);
    await run(check, [structuredClone(sourceRow), structuredClone(destinationRow)]);
    await assert.rejects(run(check, [structuredClone(destinationRow), { ...sourceRow, ended_at: null }]));
    await assert.rejects(run(check, [structuredClone(destinationRow)]));
    await assert.rejects(run(check, [{ ...destinationRow, ended_at: sourceRow.ended_at }, structuredClone(sourceRow)]));
  }
  const raceCheck = historyAssertions(cases[0]);
  await run(raceCheck, [{ ...sourceRow, ended_by: null, ended_at: null }], { status: 409 });
  await assert.rejects(run(raceCheck, [structuredClone(sourceRow)], { status: 409 }));
});
