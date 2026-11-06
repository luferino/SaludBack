import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createOralSurgeryDraftRouter } from '../../src/modules/oral-surgery-drafts/index.ts';
import { PgOralSurgeryDraftRepository } from '../../src/modules/oral-surgery-drafts/infrastructure/pg-oral-surgery-draft.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const patient = '10000000-0000-4000-8000-000000000002';
const subject = '10000000-0000-4000-8000-000000000003';
const group = '10000000-0000-4000-8000-000000000004';
const period = '10000000-0000-4000-8000-000000000005';
const headers = { 'content-type': 'application/json', 'x-role': 'estudiante',
  'x-permissions': 'oral-surgery-drafts:read,oral-surgery-drafts:write' };
const input = { patient_id: patient, subject_id: subject, academic_group_id: group };
const row = (content = {}) => ({ id: '1', clinical_record_id: '10', patient_id: patient,
  author_id: user, origin_student_habilitation_id: period, origin_subject_id: subject,
  origin_group_id: group, content, status: 'draft', version: '1',
  created_at: '2026-11-05T10:00:00.000Z', updated_at: '2026-11-05T10:00:00.000Z' });

async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: user, role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/oral-surgery-drafts', createOralSurgeryDraftRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/oral-surgery-drafts`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, body, requestHeaders = headers) => fetch(base, {
  method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
});

test('S1/S2: incomplete drafts round-trip omitted, null and false answers without inventing clinical data', async () => {
  const saved = [];
  const repository = {
    async create(value, actor) { assert.deepEqual(actor, { id: user, role: 'estudiante' });
      const draft = { ...row(value.content), id: String(saved.length + 1) }; saved.push(draft); return draft; },
    async get(id) { return saved.find(item => item.id === id); },
  };
  await serve(repository, async base => {
    for (const content of [{}, { medical_history: { hospitalized: null } },
      { treatment_plan: { procedure: '\u{1F600}'.repeat(4000) } },
      { admission_date: '2026-11-05', medical_history: { hospitalized: false, taking_medication: true, medication: 'Example' },
        extraoral_exam: { facial_symmetry: null }, treatment_plan: { procedure: 'Pending' } }]) {
      const response = await post(base, { ...input, content });
      assert.equal(response.status, 201);
      const created = await response.json();
      assert.deepEqual(created.content, content);
      const read = await fetch(`${base}/${created.id}`, { headers });
      assert.equal(read.status, 200); assert.deepEqual(await read.json(), created);
    }
    assert.equal(saved.length, 4);
    assert.equal(Object.hasOwn(saved[0].content, 'medical_history'), false);
    assert.equal(saved[1].content.medical_history.hospitalized, null);
    assert.equal(saved[3].content.medical_history.hospitalized, false);
  });
});

test('S3: exact permissions and roles deny before reads or writes, including admin/teacher clinical writes', async () => {
  let calls = 0;
  const repository = { async create() { calls++; }, async get() { calls++; },
    async list() { calls++; }, async edit() { calls++; } };
  await serve(repository, async base => {
    for (const method of ['POST', 'PATCH', 'GET']) {
      for (const [custom, code, message] of [
        [{ 'content-type': 'application/json' }, 'UNAUTHORIZED', 'Authentication required'],
        [{ ...headers, 'x-permissions': 'unrelated' }, 'FORBIDDEN',
          `Permission 'oral-surgery-drafts:${method === 'GET' ? 'read' : 'write'}' required`],
        ...(method === 'GET' ? [] : ['teacher', 'admin'].map(role =>
          [{ ...headers, 'x-role': role }, 'FORBIDDEN', 'student author role required'])),
      ]) {
        const response = await fetch(method === 'PATCH' ? `${base}/1` : base, {
          method, headers: custom, ...(method === 'GET' ? {} : { body: '{}' }),
        });
        assert.equal(response.status, code === 'UNAUTHORIZED' ? 401 : 403);
        assert.deepEqual(await response.json(), { error: { code, message } });
      }
    }
  });
  assert.equal(calls, 0);
});

test('S2/S3: malformed content and provenance overrides fail without changing saved drafts or counters', async () => {
  let calls = 0;
  const repository = { async create() { calls++; }, async edit() { calls++; } };
  await serve(repository, async base => {
    for (const content of [[], null, { consent: true }, { medical_history: { hospitalized: 'No' } },
      { medical_history: { hospitalized: 0 } }, { medical_history: { unknown: true } },
      { treatment_plan: { procedure: 'x'.repeat(4001) } }, { treatment_plan: { procedure: '\u{1F600}'.repeat(4001) } },
      { treatment_plan: { procedure: 'before\u0000after' } }, { admission_date: '2026-02-30' }]) {
      const response = await post(base, { ...input, content });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
    for (const body of [{ ...input, author_id: user }, { ...input, subject_id: 'bad' }]) {
      assert.equal((await post(base, body)).status, 400);
    }
    for (const body of [{ content: {}, expected_version: '0' }, { content: {} },
      { content: {}, expected_version: '1', origin_group_id: group }]) {
      const response = await fetch(`${base}/1`, { method: 'PATCH', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
  });
  assert.equal(calls, 0);
});

test('S5: deliberate creation produces separate encounters; edits resume by ID and replace content explicitly', async () => {
  const items = [];
  const repository = {
    async create(value) { const item = { ...row(value.content), id: String(items.length + 1) }; items.push(item); return item; },
    async list(filter, actor) { assert.equal(filter.patientId, patient); assert.equal(filter.limit, 50);
      assert.equal(actor.id, user); return items; },
    async edit(id, version, content, actor) { assert.equal(id, '1'); assert.equal(version, '1');
      assert.equal(actor.id, user); items[0] = { ...items[0], content, version: '2' }; return items[0]; },
  };
  await serve(repository, async base => {
    for (let i = 0; i < 2; i++) assert.equal((await post(base, input)).status, 201);
    const listed = await fetch(`${base}?patient_id=${patient}`, { headers });
    assert.equal(listed.status, 200); assert.deepEqual((await listed.json()).items.map(item => item.id), ['1', '2']);
    const edited = await fetch(`${base}/1`, { method: 'PATCH', headers,
      body: JSON.stringify({ expected_version: '1', content: { medical_history: { hospitalized: null } } }) });
    assert.equal(edited.status, 200); assert.equal((await edited.json()).version, '2');
    assert.deepEqual(items[1].content, {});
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
    if (sql.includes('INSERT INTO oral_surgery_drafts')) return { rows: [{ ...row(JSON.parse(params[6])), id: String(++nextId) }] };
    if (sql.includes('UPDATE oral_surgery_drafts')) return { rows: conflict ? [] : [{ ...row(JSON.parse(params[2])), version: '2' }] };
    if (sql.includes('FROM oral_surgery_drafts')) return { rows: [row()] };
    throw new Error(`unexpected SQL ${sql}`);
  } };
  const unit = { async withTransaction(run) { events.push('BEGIN'); try {
    const result = await run(db); events.push('COMMIT'); return result;
  } catch (error) { events.push('ROLLBACK'); throw error; } } };
  return { repository: new PgOralSurgeryDraftRepository(unit, db), calls, events };
}

test('S4/S5: repository creates encounters atomically with explicit enabled subject, current context and shared history', async () => {
  const { repository, calls, events } = fakeDatabase();
  const actor = { id: user, role: 'estudiante' };
  const value = { patientId: patient, subjectId: subject, groupId: group, content: {} };
  assert.notEqual((await repository.create(value, actor)).id, (await repository.create(value, actor)).id);
  assert.deepEqual(events, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  const periods = calls.find(call => call.sql.includes('FROM student_academic_habilitations h'));
  assert.match(periods.sql, /JOIN oral_surgery_subjects/); assert.match(periods.sql, /c.code = 'odontology'/);
  assert.match(periods.sql, /h.revoked_at IS NULL/); assert.match(periods.sql, /FOR UPDATE OF h/);
  const history = calls.find(call => call.sql.includes('INSERT INTO clinical_records'));
  assert.match(history.sql, /ON CONFLICT \(patient_id\) DO NOTHING/);
  assert.ok(calls.indexOf(periods) < calls.indexOf(history));
});

test('S6: inactive authors or missing assignments cannot write; restored current periods need not equal original period', async () => {
  for (const options of [{ inactive: true }, { assignment: false }]) {
    const { repository, calls, events } = fakeDatabase(options);
    await assert.rejects(repository.create({ patientId: patient, subjectId: subject, groupId: group, content: {} },
      { id: user, role: 'estudiante' }), error => [403, 404].includes(error.statusCode));
    assert.equal(calls.some(call => /INSERT|UPDATE oral_surgery_drafts/.test(call.sql)), false);
    assert.deepEqual(events, ['BEGIN', 'ROLLBACK']);
  }
  const { repository, calls } = fakeDatabase();
  await repository.edit('1', '1', {}, { id: user, role: 'estudiante' });
  const periods = calls.find(call => call.sql.includes('FROM student_academic_habilitations h'));
  assert.deepEqual(periods.params, [user, subject, group]);
  assert.doesNotMatch(periods.sql, /origin_student_habilitation_id/);
  const edit = calls.find(call => call.sql.includes('UPDATE oral_surgery_drafts'));
  assert.match(edit.sql, /version = version \+ 1/); assert.match(edit.sql, /version = \$2/);
});

test('S3/S6: reads bind role and live author/teacher origin context; admin global consultation never enables writes', async () => {
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

test('oral surgery migrations never re-create a constraint or index name owned by an earlier migration', () => {
  // Constraints, indexes, functions and triggers share namespaces; comments are ignored.
  const names = file => [...readFileSync(`src/db/migrations/${file}`, 'utf8').replace(/--.*$/gm, '')
    .matchAll(/(?:(?<!DROP\s+)\bCONSTRAINT|\bCREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?|\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER))\s+(\w+)/gi)]
    .map(match => match[1].toLowerCase());
  const migrations = readdirSync('src/db/migrations').filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  const earlier = new Set(migrations.filter(name => name < '038').flatMap(names));
  for (const file of migrations.filter(name => name >= '038')) {
    for (const name of names(file)) assert.equal(earlier.has(name), false, `${file} re-creates ${name}`);
  }
});

test('S1/S3/S7: schema enforces draft-only immutable provenance and permission seeds grant no admin clinical write', () => {
  const schema = readFileSync('src/db/migrations/040_create_oral_surgery_drafts.sql', 'utf8');
  const seed = readFileSync('src/db/migrations/041_seed_oral_surgery_draft_permissions.sql', 'utf8');
  assert.match(schema, /CHECK \(status = 'draft'\)/);
  assert.match(schema, /jsonb_typeof\(content\) = 'object'/);
  assert.match(schema, /BEFORE UPDATE ON oral_surgery_drafts/);
  assert.match(schema, /NEW.origin_student_habilitation_id/);
  assert.match(schema, /REFERENCES oral_surgery_subjects\(subject_id\)/);
  assert.match(seed, /\('estudiante', 'oral-surgery-drafts:write'\)/);
  assert.match(seed, /\('admin', 'oral-surgery-drafts:read'\)/);
  assert.doesNotMatch(seed, /\('(?:admin|teacher)', 'oral-surgery-drafts:write'\)/);
});
