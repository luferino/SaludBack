import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const CONFIG = { DATABASE_URL: 'postgres://synthetic.invalid/no-connect', JWT_SECRET: 'synthetic-revoke-secret', CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'revoke-test', JWT_PREVIOUS_SECRETS: '[]', JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3' };
Object.assign(process.env, CONFIG);
const [{ createApp }, { JwtTokenService }] = await Promise.all([import('../../src/app.ts'), import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts')]);
const ACTOR = '40000000-0000-4000-8000-000000000001';
const PERIOD = '60000000-0000-4000-8000-000000000001';
const TOKEN_PERMISSIONS = ['student-habilitations:write', 'student-habilitations:revoke'];

function fakePool() {
  const state = { grants: new Map([['teacher', ['student-habilitations:write']]]), period: { id: PERIOD, student_id: '30000000-0000-4000-8000-000000000001', subject_id: '10000000-0000-4000-8000-000000000001', academic_group_id: '20000000-0000-4000-8000-000000000001', activated_by: '80000000-0000-4000-8000-000000000001', activated_at: new Date('2026-01-01T00:00:00Z'), revoked_by: null, revoked_at: null }, assignments: [{ id: '41', patient_id: '90000000-0000-4000-8000-000000000001', student_habilitation_id: PERIOD, assigned_by: ACTOR, ended_by: null, ended_at: null, end_reason: null }], calls: [], commits: 0, rollbacks: 0, contextActive: true };
  async function query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') { if (sql === 'COMMIT') state.commits++; if (sql === 'ROLLBACK') state.rollbacks++; return { rows: [] }; }
    if (sql.includes('FROM role_permissions')) return { rows: (state.grants.get(params[0]) ?? []).map(permission => ({ permission })) };
    if (sql.includes('FROM teachers WHERE user_id')) return { rows: [ACTOR, '41000000-0000-4000-8000-000000000001'].includes(params[0]) ? [{ id: '50000000-0000-4000-8000-000000000001' }] : [] };
    if (sql.includes('FROM teacher_academic_habilitations')) return { rows: state.contextActive ? [{ id: 'context', subject_id: state.period.subject_id, academic_group_id: state.period.academic_group_id }] : [] };
    if (sql.includes('FROM student_academic_habilitations') && sql.includes('FOR UPDATE')) return { rows: state.period ? [{ ...state.period }] : [] };
    if (sql.includes('SELECT DISTINCT patient_id FROM patient_assignments')) return { rows: state.assignments.filter(a => a.student_habilitation_id === PERIOD && a.ended_at === null).map(a => ({ patient_id: a.patient_id })) };
    if (sql.includes('FROM patients') && sql.includes('FOR UPDATE')) return { rows: [{ id: params[0] }] };
    if (sql.includes('FROM patient_assignments') && sql.includes('FOR UPDATE')) return { rows: state.assignments.filter(a => a.student_habilitation_id === PERIOD && a.ended_at === null) };
    if (sql.includes('UPDATE patient_assignments')) { for (const a of state.assignments) if (a.student_habilitation_id === params[0] && a.ended_at === null) { a.ended_by = params[1]; a.ended_at = new Date('2026-02-01T00:00:00Z'); } return { rows: state.assignments.filter(a => a.student_habilitation_id === params[0] && a.ended_at !== null) }; }
    if (sql.includes('UPDATE student_academic_habilitations')) { if (state.period.revoked_at === null) { state.period.revoked_by = params[1]; state.period.revoked_at = new Date('2026-02-01T00:00:00Z'); } return { rows: [{ ...state.period }] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { state, query, async connect() { return { query, release() {} }; } };
}

async function withApp(pool, run) {
  const server = createServer(createApp(pool)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const tokens = new JwtTokenService({ secret: CONFIG.JWT_SECRET, secretKid: CONFIG.JWT_SECRET_KID, previousSecrets: [], expiresIn: '1h' });
  try { await run(`http://127.0.0.1:${server.address().port}`, tokens); } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

async function request(base, tokens, permissions = TOKEN_PERMISSIONS, role = 'teacher', path = `/student-habilitations/${PERIOD}/revoke`, actor = ACTOR) {
  const token = await tokens.sign({ role, sub: actor, username: 'actor', permissions });
  return fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
}

test('student revocation requires its fresh distinct grant, closes only exact-period active assignments, and repeats original audit', async () => {
  const pool = fakePool();
  const newer = { ...pool.state.assignments[0], id: '42', student_habilitation_id: '70000000-0000-4000-8000-000000000001', ended_by: null, ended_at: null };
  const manuallyEnded = { ...pool.state.assignments[0], id: '40', ended_by: '80000000-0000-4000-8000-000000000001', ended_at: new Date('2026-01-15T00:00:00Z'), end_reason: 'manual' };
  pool.state.assignments.push(manuallyEnded, newer);
  await withApp(pool, async (base, tokens) => {
    const noRevoke = await request(base, tokens, ['student-habilitations:write']);
    assert.equal(noRevoke.status, 403);
    pool.state.grants.set('teacher', TOKEN_PERMISSIONS);
    const first = await request(base, tokens);
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.deepEqual(body, { id: PERIOD, student_id: pool.state.period.student_id, subject_id: pool.state.period.subject_id, academic_group_id: pool.state.period.academic_group_id, activated_by: pool.state.period.activated_by, activated_at: '2026-01-01T00:00:00.000Z', revoked_by: ACTOR, revoked_at: '2026-02-01T00:00:00.000Z' });
    const repeat = await request(base, tokens, TOKEN_PERMISSIONS, 'teacher', `/student-habilitations/${PERIOD}/revoke`, '41000000-0000-4000-8000-000000000001');
    assert.equal(repeat.status, 200);
    assert.deepEqual(await repeat.json(), body);
  });
  assert.equal(pool.state.assignments[0].ended_by, ACTOR);
  assert.equal(pool.state.assignments[0].ended_at.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.deepEqual(pool.state.assignments[1], manuallyEnded);
  assert.equal(pool.state.assignments[2].ended_at, null);
  assert.equal(pool.state.commits, 2);
});

test('write grant alone, admin role without teacher profile, and missing teacher context cannot revoke', async () => {
  const pool = fakePool();
  pool.state.grants.set('admin', ['student-habilitations:revoke']);
  pool.state.grants.set('teacher', TOKEN_PERMISSIONS);
  pool.state.contextActive = false;
  const beforePeriod = { ...pool.state.period };
  await withApp(pool, async (base, tokens) => {
    const contextDenied = await request(base, tokens);
    assert.equal(contextDenied.status, 403);
    assert.deepEqual(await contextDenied.json(), { error: { code: 'FORBIDDEN', message: 'an active teacher context is required' } });
    const adminDenied = await request(base, tokens, TOKEN_PERMISSIONS, 'admin', `/student-habilitations/${PERIOD}/revoke`, '80000000-0000-4000-8000-000000000001');
    assert.equal(adminDenied.status, 403);
    assert.equal((await request(base, tokens, TOKEN_PERMISSIONS, 'teacher', '/student-habilitations/not-a-uuid/revoke')).status, 400);
  });
  assert.deepEqual(pool.state.period, beforePeriod);
  assert.equal(pool.state.assignments[0].ended_at, null);
  assert.equal(pool.state.commits, 0);
  assert.equal(pool.state.rollbacks, 2);
});
