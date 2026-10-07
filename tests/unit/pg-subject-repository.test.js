import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgSubjectRepository } from '../../src/modules/subjects/infrastructure/repositories/pg-subject.repository.ts';
import { Subject } from '../../src/modules/subjects/domain/subject.entity.ts';

const CREATED_AT = new Date('2026-02-03T04:05:06Z');
function row(overrides = {}) {
  return { id: 'subject-1', name: 'Biology', created_by: null, created_at: CREATED_AT, ...overrides };
}

test('create uses parameterized insert and maps the persisted row', async () => {
  let call;
  const repository = new PgSubjectRepository({ async query(text, params) { call = { text, params }; return { rows: [row({ created_by: 'actor-1' })] }; } });
  const result = await repository.create(new Subject({ name: 'Biology', createdBy: 'actor-1' }));
  assert.match(call.text, /INSERT INTO subjects \(name, created_by\) VALUES \(\$1, \$2\) RETURNING id, name, created_by, created_at/);
  assert.deepEqual(call.params, ['Biology', 'actor-1']);
  assert.deepEqual([result.id, result.name, result.createdBy, result.createdAt], ['subject-1', 'Biology', 'actor-1', CREATED_AT]);
});

test('list uses deterministic ordering and parameterized pagination', async () => {
  let call;
  const repository = new PgSubjectRepository({ async query(text, params) { call = { text, params }; return { rows: [row()] }; } });
  const results = await repository.list({ limit: 20, offset: 40 });
  assert.match(call.text, /ORDER BY name ASC, id ASC LIMIT \$1 OFFSET \$2/);
  assert.deepEqual(call.params, [20, 40]);
  assert.equal(results[0].name, 'Biology');
});

test('repository propagates unknown database failures unchanged', async () => {
  const failure = new Error('database unavailable');
  const repository = new PgSubjectRepository({ async query() { throw failure; } });
  await assert.rejects(() => repository.list({ limit: 1, offset: 0 }), (error) => error === failure);
});
