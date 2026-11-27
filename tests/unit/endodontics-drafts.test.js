import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createEndodonticsDraftRouter } from '../../src/modules/endodontics-drafts/index.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const user = '10000000-0000-4000-8000-000000000001';
const patient = '10000000-0000-4000-8000-000000000002';
const subject = '10000000-0000-4000-8000-000000000003';
const group = '10000000-0000-4000-8000-000000000004';
const headers = (role = 'estudiante', permissions = 'endodontics-drafts:read,endodontics-drafts:write') => ({
  'content-type': 'application/json', 'x-role': role, 'x-permissions': permissions,
});
const input = { patient_id: patient, subject_id: subject, academic_group_id: group };

async function serve(repository, run) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-role']) req.auth = { userId: user, role: req.headers['x-role'],
      permissions: String(req.headers['x-permissions'] ?? '').split(',') };
    next();
  });
  app.use('/endodontics-drafts', createEndodonticsDraftRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/endodontics-drafts`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, body, h = headers()) => fetch(base, { method: 'POST', headers: h, body: JSON.stringify(body) });
const repository = (storage) => ({
  async create(input, actor) {
    const item = { ...input, id: String(storage.length + 1), author_id: actor.id, status: 'draft', version: '1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
    storage.push(item); return item;
  },
  async get(id) { return storage.find(x => x.id === id); },
  async list() { return storage; },
  async edit(id, version, content, actor) {
    const item = storage.find(x => x.id === id);
    if (!item || item.version !== version || item.author_id !== actor.id) throw new Error('draft version changed; reload before saving');
    item.content = content; item.version = String(Number(version) + 1); return item;
  },
});

test('S4-S8: public API preserves unanswered/No, optional tooth and pain, multi-select and radiography choices', async () => {
  const storage = [];
  await serve(repository(storage), async base => {
    const content = { patient_history: { general_health: null, medication: false }, tooth_or_region: null,
      pain: { intensity: 0, location: 'molar' }, examination: { observations: null },
      radiography: { chamber: ['normal_wide', 'calcified'], canals: ['narrow'], periapical: ['normal'], notes: 'canal MV' },
      probable_diagnosis: ['reversible_pulpitis_inflammatory', 'probable_granuloma'], proposed_plan: ['pulpotomy', 'retreatment'] };
    const response = await post(base, { ...input, content });
    assert.equal(response.status, 201); assert.deepEqual((await response.json()).content, content);
  });
});

test('S5-S8: validation rejects pain bounds, unknown keys, lone surrogates and oversized text without storage writes', async () => {
  const storage = [];
  await serve(repository(storage), async base => {
    for (const [content, status] of [
      [{ pain: { intensity: -1 } }, 400], [{ pain: { intensity: 11 } }, 400],
      [{ unknown: true }, 400], [{ radiography: { notes: '\uD800' } }, 400],
      [{ radiography: { notes: 'x'.repeat(4001) } }, 400],
    ]) assert.equal((await post(base, { ...input, content })).status, status);
    for (const value of [0, 10]) assert.equal((await post(base, { ...input, content: { pain: { intensity: value } } })).status, 201);
  });
  assert.equal(storage.length, 2);
});

test('S3: role and context access is enforced before fake repository changes', async () => {
  const storage = [];
  await serve(repository(storage), async base => {
    assert.equal((await post(base, { ...input, content: {} }, headers('teacher'))).status, 403);
    assert.equal((await post(base, { ...input, content: {} }, headers('estudiante', ''))).status, 403);
  });
  assert.equal(storage.length, 0);
});

test('S2/S3: migration ledger, shared patient linkage and permissions are structurally present', () => {
  const files = readdirSync(new URL('../../src/db/migrations/', import.meta.url)).sort();
  assert.ok(files.some(x => x.startsWith('067_'))); assert.ok(files.some(x => x.startsWith('068_')));
  const sql = files.filter(x => x.startsWith('067_') || x.startsWith('068_'))
    .map(x => readFileSync(new URL(`../../src/db/migrations/${x}`, import.meta.url), 'utf8')).join('\n');
  assert.match(sql, /endodontics_drafts/); assert.match(sql, /clinical_record_id/);
  assert.match(sql, /endodontics-drafts:read/); assert.match(sql, /endodontics-drafts:write/);
});
