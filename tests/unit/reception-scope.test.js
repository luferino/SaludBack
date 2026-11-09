import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgReceptionAccessRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-access.repository.ts';

function repository({ user = true, grant = true, failure } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM users')) return { rows: user ? [{id:'user'}] : [] };
      if (sql.includes('FROM reception_career_grants')) return { rows: grant ? [{id:'grant'}] : [] };
      if (sql === 'WORK' && failure) throw failure;
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { repo: new PgReceptionAccessRepository({ async connect() { return client; } }),
    calls, released: () => released };
}
test('missing Reception account cannot execute scoped work even with a stale grant', async () => {
  const state = repository({user:false});
  let callbacks = 0;
  await assert.rejects(state.repo.withActiveCareerScope('user','kinesiology', async () => { callbacks++; }),
    {code:'NOT_FOUND'});
  assert.equal(callbacks,0);
  assert.equal(state.released(), true);
});
test('revoked or absent grant never runs scoped callback and releases transaction', async () => {
  const state = repository({grant:false});
  let callbacks = 0;
  await assert.rejects(state.repo.withActiveCareerScope('user','kinesiology', async () => { callbacks++; }),
    {code:'NOT_FOUND',message:'active career scope was not found'});
  assert.equal(callbacks,0);
  assert.equal(state.calls.at(-1),'ROLLBACK');
  assert.equal(state.released(), true);
});
test('scope callback returns only on commit and failures roll back without replay', async () => {
  const state = repository();
  let count = 0;
  assert.equal(await state.repo.withActiveCareerScope('user','kinesiology',async () => {count++;return 'ok';}),'ok');
  assert.equal(count,1);
  assert.equal(state.calls.at(-1),'COMMIT');
  assert.equal(state.released(),true);
  const error = new Error('work failed');
  const failing = repository({failure:error});
  await assert.rejects(failing.repo.withActiveCareerScope('user','kinesiology',client => client.query('WORK')),error);
  assert.equal(failing.calls.filter(sql => sql === 'WORK').length,1);
  assert.equal(failing.calls.at(-1),'ROLLBACK');
  assert.equal(failing.released(),true);
});
