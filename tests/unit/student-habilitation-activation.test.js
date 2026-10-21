import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const SYNTHETIC_CONFIG = {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect',
  JWT_SECRET: 'synthetic-student-habilitation-secret',
  CLIENT_URL: 'http://127.0.0.1:1',
  JWT_SECRET_KID: 'student-test-key',
  JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h',
  BCRYPT_COST: '4',
  RESET_TOKEN_TTL: '15',
  RESET_TOKEN_MAX_OUTSTANDING: '3',
};
Object.assign(process.env, SYNTHETIC_CONFIG);

const [{ createApp }, { JwtTokenService }] = await Promise.all([
  import('../../src/app.ts'),
  import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
]);

const STUDENT = '30000000-0000-4000-8000-000000000001';
const SUBJECT = '10000000-0000-4000-8000-000000000001';
const GROUP = '20000000-0000-4000-8000-000000000001';
const ACTOR = '40000000-0000-4000-8000-000000000001';
const TEACHER = '50000000-0000-4000-8000-000000000001';
const PERIOD = '60000000-0000-4000-8000-000000000001';
const INPUT = { student_id: STUDENT, subject_id: SUBJECT, academic_group_id: GROUP };

function makePool({ studentExists = true, teacherExists = true, activeContext = true, duplicate = false, insertFailure = false } = {}) {
  const state = { grants: new Map([['teacher', []], ['admin', []]]), studentExists, teacherExists, activeContext, duplicate, insertFailure, periods: [], queries: [], inserts: 0, commits: 0, rollbacks: 0, releases: 0 };
  const run = async (text, params = [], transaction = false) => {
    state.queries.push({ text, params });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      if (text === 'COMMIT') state.commits += 1;
      if (text === 'ROLLBACK') state.rollbacks += 1;
      return { rows: [] };
    }
    if (text.includes('FROM role_permissions')) return { rows: (state.grants.get(params[0]) ?? []).map((permission) => ({ permission })) };
    if (text.includes('FROM teachers WHERE user_id')) {
      const teacherExists = params[0] === ACTOR && state.teacherExists;
      return { rows: teacherExists ? [{ id: TEACHER }] : [] };
    }
    if (text.includes('FROM teacher_academic_habilitations')) return { rows: state.activeContext ? [{ id: PERIOD }] : [] };
    if (text.includes('FROM students WHERE id')) return { rows: state.studentExists ? [{ id: STUDENT }] : [] };
    if (text.includes('INSERT INTO student_academic_habilitations')) {
      state.inserts += 1;
      if (state.insertFailure) throw new Error('synthetic insert failure');
      if (state.duplicate || state.periods.some((period) => period.student_id === params[0])) {
        throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'student_habilitations_one_active_context' });
      }
      const row = { id: '70000000-0000-4000-8000-000000000001', student_id: params[0], subject_id: params[1], academic_group_id: params[2], activated_by: params[3], activated_at: new Date('2026-01-02T03:04:05Z'), revoked_by: null, revoked_at: null };
      if (transaction) state.periods.push(row);
      return { rows: [row] };
    }
    throw new Error(`Unexpected query: ${text}`);
  };
  return {
    state,
    async query(text, params = []) { return run(text, params); },
    async connect() {
      return { query: (text, params = []) => run(text, params, true), release() { state.releases += 1; } };
    },
  };
}

async function withApp(pool, run) {
  const server = createServer(createApp(pool));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tokenService = new JwtTokenService({ secret: SYNTHETIC_CONFIG.JWT_SECRET, secretKid: SYNTHETIC_CONFIG.JWT_SECRET_KID, previousSecrets: [], expiresIn: '1h' });
  try { await run(`http://127.0.0.1:${server.address().port}`, tokenService); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function signed(tokenService, role = 'teacher', sub = ACTOR) {
  return tokenService.sign({ role, sub, permissions: ['student-habilitations:write'] });
}

function request(base, token, body = INPUT) {
  return fetch(`${base}/student-habilitations`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('authorized context is checked before student existence to avoid disclosing missing targets', async () => {
  const pool = makePool({ studentExists: false, activeContext: false });
  pool.state.grants.set('teacher', ['student-habilitations:write']);
  await withApp(pool, async (base, service) => {
    const response = await request(base, await signed(service));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'FORBIDDEN', message: 'an active teacher context is required' } });
  });
  assert.equal(pool.state.queries.some(({ text }) => text.includes('FROM students WHERE id')), false);
  assert.equal(pool.state.inserts, 0);
});

test('app activation observes fresh grants, denies admin and missing teacher context, and uses verified actor', async () => {
  const pool = makePool();
  pool.state.grants.set('teacher', []);
  await withApp(pool, async (base, service) => {
    const optionsToken = await signed(service);
    assert.equal((await request(base, optionsToken)).status, 403);
    pool.state.grants.set('teacher', ['student-habilitations:write']);
    pool.state.teacherExists = false;
    const profileMissing = await request(base, optionsToken);
    assert.equal(profileMissing.status, 403);
    assert.deepEqual(await profileMissing.json(), { error: { code: 'FORBIDDEN', message: 'an active teacher context is required' } });
    pool.state.teacherExists = true;
    pool.state.activeContext = false;
    assert.equal((await request(base, optionsToken)).status, 403);
    pool.state.activeContext = true;
    const created = await request(base, optionsToken, { ...INPUT, activated_by: 'spoofed' });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.deepEqual(body, { id: '70000000-0000-4000-8000-000000000001', student_id: STUDENT, subject_id: SUBJECT, academic_group_id: GROUP, activated_by: ACTOR, activated_at: '2026-01-02T03:04:05.000Z', revoked_by: null, revoked_at: null });
    const invalidUuid = await request(base, optionsToken, { ...INPUT, subject_id: 'malformed' });
    assert.equal(invalidUuid.status, 400);
    assert.deepEqual(await invalidUuid.json(), { error: { code: 'BAD_REQUEST', message: 'subject_id must be a UUID' } });
    assert.equal((await fetch(`${base}/student-habilitations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(INPUT) })).status, 401);
    pool.state.grants.set('teacher', []);
    assert.equal((await request(base, optionsToken)).status, 403);
    const adminToken = await signed(service, 'admin', '80000000-0000-4000-8000-000000000001');
    pool.state.grants.set('admin', ['student-habilitations:write']);
    const adminDenied = await request(base, adminToken);
    assert.equal(adminDenied.status, 403);
    assert.deepEqual(await adminDenied.json(), { error: { code: 'FORBIDDEN', message: 'an active teacher context is required' } });
  });
  assert.equal(pool.state.periods.length, 1);
  assert.equal(pool.state.periods[0].activated_by, ACTOR);
  assert.equal(pool.state.inserts, 1);
  assert.equal(pool.state.commits, 1);
  assert.equal(pool.state.rollbacks, 3);
  assert.equal(pool.state.releases, 4);
  const contextQuery = pool.state.queries.find(({ text }) => text.includes('FROM teacher_academic_habilitations'));
  assert.match(contextQuery.text, /FOR UPDATE/);
  assert.ok(pool.state.queries.findIndex(({ text }) => text.includes('FROM teacher_academic_habilitations'))
    < pool.state.queries.findIndex(({ text }) => text.includes('FROM students WHERE id')));
});

test('repository maps duplicate and missing student references; failed transaction rolls back and releases', async () => {
  const pool = makePool({ duplicate: true });
  pool.state.grants.set('teacher', ['student-habilitations:write']);
  await withApp(pool, async (base, service) => {
    const response = await request(base, await signed(service));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: 'CONFLICT', message: 'student is already active in this subject and academic group' } });
  });
  assert.equal(pool.state.inserts, 1);
  assert.equal(pool.state.periods.length, 0);
  assert.equal(pool.state.rollbacks, 1);
  assert.equal(pool.state.releases, 1);

  const missing = makePool({ studentExists: false });
  missing.state.grants.set('teacher', ['student-habilitations:write']);
  await withApp(missing, async (base, service) => {
    const response = await request(base, await signed(service));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'student was not found' } });
  });
  assert.equal(missing.state.inserts, 0);
  assert.equal(missing.state.rollbacks, 1);
  assert.equal(missing.state.releases, 1);

  const failed = makePool({ insertFailure: true });
  failed.state.grants.set('teacher', ['student-habilitations:write']);
  await withApp(failed, async (base, service) => {
    const response = await request(base, await signed(service));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
  });
  assert.equal(failed.state.periods.length, 0);
  assert.equal(failed.state.rollbacks, 1);
  assert.equal(failed.state.releases, 1);
});
