import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgReceptionAccessRepository } from '../../src/modules/reception/infrastructure/repositories/pg-reception-access.repository.ts';

function repository({ user = true, grant = true, roleGrant = true, role = 'reception', failure, insertError, insertRows = [] } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM users')) return { rows: user ? [{id:'user',role}] : [] };
      if (sql.includes('FROM user_role_grants')) return { rows: roleGrant ? [{id:'role-grant'}] : [] };
      if (sql.includes('FROM reception_career_grants')) return { rows: grant ? [{id:'grant'}] : [] };
      if (sql.startsWith('INSERT INTO reception_career_grants')) {
        if (insertError) throw insertError;
        return { rows: insertRows };
      }
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
test('dual-role scoped writes lock and revalidate the exact active role grant before career scope', async () => {
  const state = repository({ role: 'estudiante' });
  let callbacks = 0;
  await state.repo.withActiveCareerScope('user', 'kinesiology', async () => { callbacks++; }, 'exact-grant');
  const userLock = state.calls.findIndex(sql => sql.includes('FROM users'));
  const roleLock = state.calls.findIndex(sql => sql.includes('FROM user_role_grants'));
  const careerLock = state.calls.findIndex(sql => sql.includes('FROM reception_career_grants'));
  assert.ok(userLock < roleLock && roleLock < careerLock);
  assert.equal(callbacks, 1);

  const revoked = repository({ role: 'estudiante', roleGrant: false });
  await assert.rejects(revoked.repo.withActiveCareerScope('user', 'kinesiology', async () => { callbacks++; }, 'old-grant'),
    { statusCode: 401, code: 'UNAUTHORIZED' });
  assert.equal(callbacks, 1);
  assert.equal(revoked.calls.at(-1), 'ROLLBACK');
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

const grantRow = { id: 'career-grant', user_id: 'user', career_code: 'kinesiology', granted_by: 'admin',
  granted_at: new Date('2026-01-01T00:00:00Z'), revoked_by: null, revoked_at: null };

test('grantCareer succeeds for a primary Reception account', async () => {
  const state = repository({ insertRows: [grantRow] });
  const grant = await state.repo.grantCareer('user', 'kinesiology', 'admin');
  assert.equal(grant.careerCode, 'kinesiology');
  assert.equal(state.calls.at(-1), 'COMMIT');
  assert.equal(state.released(), true);
});

test('grantCareer succeeds for a Student with an active Reception role grant', async () => {
  const state = repository({ role: 'estudiante', insertRows: [grantRow] });
  const grant = await state.repo.grantCareer('user', 'kinesiology', 'admin');
  assert.equal(grant.careerCode, 'kinesiology');
  assert.equal(state.calls.at(-1), 'COMMIT');
});

test('grantCareer maps a foreign-key failure on the grant INSERT to the stable 404', async () => {
  const state = repository({ insertError: { code: '23503' } });
  await assert.rejects(state.repo.grantCareer('user', 'kinesiology', 'admin'),
    { statusCode: 404, code: 'NOT_FOUND', message: 'Reception account was not found' });
  assert.equal(state.calls.at(-1), 'ROLLBACK');
  assert.equal(state.released(), true);
});

const ineligibleGrants = [
  ['a missing account', { user: false }],
  ['a non-student primary role', { role: 'profesor' }],
  ['a Student without an active Reception role grant', { role: 'estudiante', roleGrant: false }],
];
for (const [label, options] of ineligibleGrants) {
  test(`grantCareer rejects ${label} as career not found without running the INSERT`, async () => {
    const state = repository({ ...options, insertRows: [grantRow] });
    await assert.rejects(state.repo.grantCareer('user', 'kinesiology', 'admin'),
      { statusCode: 404, code: 'NOT_FOUND', message: 'career was not found' });
    assert.equal(state.calls.some(sql => sql.startsWith('INSERT')), false);
    assert.equal(state.calls.at(-1), 'ROLLBACK');
    assert.equal(state.released(), true);
  });
}

test('withActiveCareerScope without a role grant treats a non-Reception primary role as account not found', async () => {
  const state = repository({ role: 'estudiante' });
  let callbacks = 0;
  await assert.rejects(state.repo.withActiveCareerScope('user', 'kinesiology', async () => { callbacks++; }),
    { statusCode: 404, code: 'NOT_FOUND', message: 'Reception account was not found' });
  assert.equal(callbacks, 0);
  assert.equal(state.calls.at(-1), 'ROLLBACK');
  assert.equal(state.released(), true);
});

for (const role of ['profesor', 'reception']) {
  test(`withActiveCareerScope with a role grant rejects primary role ${role} as an invalid grant`, async () => {
    const state = repository({ role });
    let callbacks = 0;
    await assert.rejects(state.repo.withActiveCareerScope('user', 'kinesiology', async () => { callbacks++; }, 'exact-grant'),
      { statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid or revoked Reception role grant' });
    assert.equal(callbacks, 0);
    assert.equal(state.calls.at(-1), 'ROLLBACK');
  });
}
