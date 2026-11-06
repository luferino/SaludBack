import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgCareerRepository } from '../../src/modules/careers/infrastructure/repositories/pg-career.repository.ts';
import { Career } from '../../src/modules/careers/domain/career.entity.ts';

test('list uses a parameterless ordered select and maps only the career columns', async () => {
  let call;
  const repository = new PgCareerRepository({
    async query(text, params) {
      call = { text, params };
      return { rows: [{ id: 'career-1', code: 'kinesiology', name: 'Kinesiología' }] };
    },
  });
  const results = await repository.list();
  assert.match(call.text, /SELECT id, code, name FROM careers ORDER BY name ASC, id ASC/);
  assert.equal(call.params, undefined);
  assert.deepEqual([results[0].id, results[0].code, results[0].name], ['career-1', 'kinesiology', 'Kinesiología']);
});

test('repository propagates database failures unchanged', async () => {
  const failure = new Error('database unavailable');
  const repository = new PgCareerRepository({ async query() { throw failure; } });
  await assert.rejects(() => repository.list(), (error) => error === failure);
});

test('career serialization exposes exactly id, code, and name', () => {
  const serialized = new Career({ id: 'career-1', code: 'odontology', name: 'Odontología' }).toJSON();
  assert.deepEqual(serialized, { id: 'career-1', code: 'odontology', name: 'Odontología' });
  assert.deepEqual(Object.keys(serialized), ['id', 'code', 'name']);
});
