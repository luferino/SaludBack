import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgSubjectRepository } from '../../src/modules/subjects/infrastructure/repositories/pg-subject.repository.ts';
import { Subject } from '../../src/modules/subjects/domain/subject.entity.ts';
import { NotFoundError } from '../../src/modules/shared/domain/errors.ts';

const CREATED_AT = new Date('2026-02-03T04:05:06Z');
const CAREER_ID = '11111111-1111-4111-8111-111111111111';
function row(overrides = {}) {
  return { id: 'subject-1', name: 'Biology', career_id: CAREER_ID, created_by: null, created_at: CREATED_AT, ...overrides };
}

test('create uses parameterized insert with the career and maps the persisted row', async () => {
  let call;
  const repository = new PgSubjectRepository({ async query(text, params) { call = { text, params }; return { rows: [row({ created_by: 'actor-1' })] }; } });
  const result = await repository.create(new Subject({ name: 'Biology', careerId: CAREER_ID, createdBy: 'actor-1' }));
  assert.match(call.text, /INSERT INTO subjects \(name, career_id, created_by\) VALUES \(\$1, \$2, \$3\) RETURNING id, name, career_id, created_by, created_at/);
  assert.deepEqual(call.params, ['Biology', CAREER_ID, 'actor-1']);
  assert.deepEqual([result.id, result.name, result.careerId, result.createdBy, result.createdAt], ['subject-1', 'Biology', CAREER_ID, 'actor-1', CREATED_AT]);
});

test('create translates only the subject career foreign key to reusable not-found', async () => {
  const missingCareer = Object.assign(new Error('foreign key'), { code: '23503', constraint: 'subjects_career_id_fkey' });
  const repository = new PgSubjectRepository({ async query() { throw missingCareer; } });
  await assert.rejects(
    () => repository.create(new Subject({ name: 'Biology', careerId: CAREER_ID })),
    (error) => error instanceof NotFoundError && error.statusCode === 404 && error.message === 'career was not found',
  );
});

test('create propagates other foreign key and unknown database failures by identity', async () => {
  const failures = [
    Object.assign(new Error('actor foreign key'), { code: '23503', constraint: 'subjects_created_by_fkey' }),
    new Error('database unavailable'),
  ];
  for (const failure of failures) {
    const repository = new PgSubjectRepository({ async query() { throw failure; } });
    await assert.rejects(() => repository.create(new Subject({ name: 'Biology', careerId: CAREER_ID })), (error) => error === failure);
  }
});

test('list uses deterministic ordering and parameterized pagination', async () => {
  let call;
  const repository = new PgSubjectRepository({ async query(text, params) { call = { text, params }; return { rows: [row()] }; } });
  const results = await repository.list({ limit: 20, offset: 40 });
  assert.match(call.text, /SELECT id, name, career_id, created_by, created_at FROM subjects ORDER BY name ASC, id ASC LIMIT \$1 OFFSET \$2/);
  assert.doesNotMatch(call.text, /WHERE/);
  assert.deepEqual(call.params, [20, 40]);
  assert.equal(results[0].name, 'Biology');
  assert.equal(results[0].careerId, CAREER_ID);
});

test('list parameterizes the optional career filter before pagination', async () => {
  let call;
  const repository = new PgSubjectRepository({ async query(text, params) { call = { text, params }; return { rows: [] }; } });
  const results = await repository.list({ careerId: CAREER_ID, limit: 7, offset: 9 });
  assert.match(call.text, /FROM subjects WHERE career_id = \$1 ORDER BY name ASC, id ASC LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(call.params, [CAREER_ID, 7, 9]);
  assert.deepEqual(results, []);
});

test('repository propagates unknown database failures unchanged', async () => {
  const failure = new Error('database unavailable');
  const repository = new PgSubjectRepository({ async query() { throw failure; } });
  await assert.rejects(() => repository.list({ limit: 1, offset: 0 }), (error) => error === failure);
});
