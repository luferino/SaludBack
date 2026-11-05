import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListCareers } from '../../src/modules/careers/application/list-careers.usecase.ts';
import { Career } from '../../src/modules/careers/domain/career.entity.ts';

test('list returns the repository careers unchanged and takes no pagination or filter input', async () => {
  const careers = [
    new Career({ id: 'career-1', code: 'kinesiology', name: 'Kinesiología' }),
    new Career({ id: 'career-2', code: 'odontology', name: 'Odontología' }),
  ];
  let calls = 0;
  const repository = { async list() { calls += 1; return careers; } };
  const result = await new ListCareers({ repository }).execute();
  assert.deepEqual(result, { items: careers });
  assert.equal(calls, 1);
});
